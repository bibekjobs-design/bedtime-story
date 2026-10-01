import time
from typing import Dict, Any
from google import genai
from google.genai import types

from app.config import settings
from app.db import get_supabase
from app.services.story_service import call_gemini_with_fallback, verify_content_safety
from app.services.tts_service import synthesize_story_audio
from app.services.usage_service import check_and_increment_usage

def generate_personalized_story_text(
    child_name: str,
    base_title: str,
    base_teaser: str,
    category_name: str,
    age_label: str,
    language_label: str,
    max_retries: int = 4
) -> str:
    """
    Generates an original bedtime story (~1300-1550 words) that weaves the child's name
    into the peaceful adventure as a gentle, beloved companion.
    """
    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    prompt = f"""You are a master children's bedtime storyteller creating a deeply personalized, soothing bedtime tale.

Story Context:
- Child's Name: {child_name}
- Inspired by: {base_title} ({base_teaser})
- Category: {category_name}
- Target Age Group: {age_label}
- Language: {language_label}

Storytelling Guidelines:
1. Weave {child_name} gently into the story as the cozy, curious, and beloved adventurer who explores this peaceful world alongside friendly guides.
2. Target Length: Approximately 1300 to 1550 words (aim for a slow, calming 10-12 minute narration).
3. Pacing: Starts warm and comforting, and gradually slows down into sleepy, repetitive, tranquil rhythm until {child_name} drifts softly to sleep in their cozy bed.
4. Absolute Safety: 100% positive, warm, gentle sensory descriptions (soft starlight, fluffy clouds, warm blankets). NO villains, surprises, loud sounds, or fear.
5. Clean prose: Pure narration text only. Do NOT include sound effects, stage notes, or headers.
"""

    response = call_gemini_with_fallback(
        client=client,
        prompt=prompt,
        config=types.GenerateContentConfig(
            temperature=0.65,
        ),
        retries_per_model=max_retries
    )
    return response.text.strip()


def create_or_get_personalized_story(
    user_id: str,
    subscription_tier: str,
    child_profile_id: str,
    base_story_text_id: str,
    voice_tier: str = "standard"
) -> Dict[str, Any]:
    """
    Stage 2 Commit for Personalized Stories:
    1. Checks if personalized story already exists in cache for this child profile.
       If yes, returns immediately (replays are free forever for this family!).
    2. Enforces monthly usage limit (Free: 0, Premium: up to 10/month).
    3. Calls Gemini to weave child's name into the full ~1300-1550 word tale.
    4. Runs automated safety check.
    5. Narrates story via Google Cloud TTS (Neural2 bedtime voice).
    6. Uploads MP3 to Supabase Storage ('story-audio' bucket under 'personalized/').
    7. Inserts into 'personalized_stories' table.
    8. Returns complete playback payload.
    """
    supabase = get_supabase()

    # 1. Fetch child profile and verify ownership
    prof_res = (
        supabase.table("child_profiles")
        .select("*, age_groups(label), languages(label, code)")
        .eq("id", child_profile_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not prof_res.data:
        raise ValueError("Child profile not found or does not belong to your account.")

    profile = prof_res.data
    child_name = profile["name"]

    # 2. Check cache first (Generate Once, Cache, Reuse - family private)
    cached_res = (
        supabase.table("personalized_stories")
        .select("*")
        .eq("child_profile_id", child_profile_id)
        .eq("base_story_text_id", base_story_text_id)
        .eq("voice_tier", voice_tier)
        .execute()
    )

    if cached_res.data:
        cached = cached_res.data[0]
        return {
            "id": cached["id"],
            "child_name": cached["child_name_used"],
            "full_text": cached["full_text"],
            "audio_url": cached["audio_url"],
            "duration_seconds": cached["duration_seconds"],
            "voice_tier": cached["voice_tier"],
            "cached": True,
        }

    # 3. Fetch base story metadata
    base_story_res = (
        supabase.table("story_texts")
        .select("*, story_categories(name), age_groups(label), languages(label, code)")
        .eq("id", base_story_text_id)
        .single()
        .execute()
    )
    if not base_story_res.data:
        raise ValueError("Base story not found.")

    base_story = base_story_res.data
    cat_name = base_story.get("story_categories", {}).get("name", "Bedtime")
    age_label = base_story.get("age_groups", {}).get("label", "kids")
    lang_label = base_story.get("languages", {}).get("label", "English")
    lang_code = base_story.get("languages", {}).get("code", "en")

    # 4. Enforce monthly personalization quota
    allowed = check_and_increment_usage(
        user_id=user_id,
        subscription_tier=subscription_tier,
        usage_type="personalization"
    )
    if not allowed:
        if subscription_tier == "free":
            raise ValueError(
                "Personalized stories (with child's name) require a Premium subscription. Upgrade to Premium for up to 10 personalized tales per month!"
            )
        else:
            raise ValueError(
                "You have reached your monthly limit of 10 personalized stories. Your quota resets next month!"
            )

    # 5. Generate personalized story text with Gemini
    full_text = generate_personalized_story_text(
        child_name=child_name,
        base_title=base_story["title"],
        base_teaser=base_story["teaser"],
        category_name=cat_name,
        age_label=age_label,
        language_label=lang_label
    )

    # 6. Safety check
    is_safe, safety_notes = verify_content_safety(
        title=f"{child_name}'s Bedtime Journey",
        story_text=full_text,
        age_label=age_label
    )
    if not is_safe:
        raise ValueError(f"Content safety check flagged story: {safety_notes}")

    # 7. Synthesize audio via Google Cloud TTS (Neural2 bedtime voice)
    audio_bytes, duration_seconds = synthesize_story_audio(
        full_text=full_text,
        language_code=lang_code,
        voice_gender="female"
    )

    # 8. Upload MP3 to Supabase Storage
    storage_path = f"personalized/{child_profile_id}/{base_story_text_id}.mp3"
    supabase.storage.from_("story-audio").upload(
        path=storage_path,
        file=audio_bytes,
        file_options={"content-type": "audio/mpeg", "upsert": "true"}
    )
    audio_url = supabase.storage.from_("story-audio").get_public_url(storage_path)

    # 9. Insert record into personalized_stories
    insert_payload = {
        "child_profile_id": child_profile_id,
        "base_story_text_id": base_story_text_id,
        "category_id": base_story["category_id"],
        "age_group_id": base_story["age_group_id"],
        "language_id": base_story["language_id"],
        "child_name_used": child_name,
        "full_text": full_text,
        "voice_tier": voice_tier,
        "voice_clone_id": None,
        "audio_url": audio_url,
        "duration_seconds": duration_seconds,
        "safety_check_status": "passed",
    }
    insert_res = supabase.table("personalized_stories").insert(insert_payload).execute()
    new_record = insert_res.data[0] if insert_res.data else insert_payload

    return {
        "id": new_record.get("id"),
        "child_name": child_name,
        "full_text": full_text,
        "audio_url": audio_url,
        "duration_seconds": duration_seconds,
        "voice_tier": voice_tier,
        "cached": False,
    }
