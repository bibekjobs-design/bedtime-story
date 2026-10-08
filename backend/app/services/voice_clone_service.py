import io
import uuid
import httpx
from typing import Dict, Any, Optional
from app.config import settings
from app.db import get_supabase
from app.services.story_service import call_gemini_with_fallback, verify_content_safety
from app.services.tts_service import synthesize_story_audio
from app.services.usage_service import check_and_increment_usage

ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1"

# Privacy: a story narrated in a parent's cloned voice is deleted this many days after it is made.
# The cloned voice itself stays until the parent deletes it. Admin stories never expire.
CLONED_STORY_RETENTION_DAYS = 10

# --- ElevenLabs narration model: ALWAYS the cheapest one ---------------------
# Single source of truth for EVERY ElevenLabs text-to-speech call in the app
# (cloned-voice narration for real users, admin test narration, and the
# premade-voice fallback all go through synthesize_cloned_story below, which
# reads this constant - there is no other ElevenLabs TTS call site).
# Flash v2.5 is billed at half the price of eleven_multilingual_v2 (Rs 3.52 vs
# Rs 7.04 per 1K characters on ElevenLabs' API pricing page, Sep 2026) and
# supports cloned (Instant Voice Clone) voices. To change the model for the
# whole app, change ONLY this line. Do not add a per-tier or per-user override
# and do not add a fallback to a pricier model.
ELEVENLABS_TTS_MODEL_ID = "eleven_flash_v2_5"

# --- PRODUCTION LIMIT: per-narration character cap for cloned-voice stories ---
# This is a permanent product limit (not a testing guardrail): Pro plan
# subscribers get up to ~2,430 characters (~3 minutes at the app's own
# ~135 wpm / ~6 chars-per-word narration pace) of parent-voice-cloned
# narration per story, 4 times a month. A parent or admin can still
# upload/select a full-length story, only the TEXT ACTUALLY SENT TO
# ELEVENLABS for narration is truncated here.
# Set to None to remove this cap entirely.
CLONED_VOICE_CHAR_LIMIT = 2430

# Backwards-compatible alias in case any other module still imports the old name.
VOICE_CLONE_TEST_CHAR_LIMIT = CLONED_VOICE_CHAR_LIMIT

# --- ADMIN TEST ACCOUNT ONLY: shorter cap so dev/testing on the admin login
# doesn't burn full-length (2,430-char / ~3 min) ElevenLabs cost every time.
# ~1,215 chars is ~1.5 minutes at the app's ~135 wpm / ~6 chars-per-word pace.
# Only applied when the caller explicitly passes admin_test=True.
ADMIN_TEST_VOICE_CLONE_CHAR_LIMIT = 1215

def _story_expiry_iso(supabase, user_id: str):
    """When a cloned-voice story should be auto-deleted (None for the admin account)."""
    from datetime import datetime, timezone, timedelta
    if _is_admin_user(supabase, user_id):
        return None
    return (datetime.now(timezone.utc) + timedelta(days=CLONED_STORY_RETENTION_DAYS)).isoformat()


async def register_parent_voice_clone(
    user_id: str,
    label: str,
    audio_bytes: bytes,
    file_ext: str = "mp3"
) -> Dict[str, Any]:
    """
    1. Uploads parent's voice recording to Supabase Storage ('voice-samples' folder).
    2. Registers the cloned voice with ElevenLabs Instant Voice Cloning if ELEVENLABS_API_KEY is configured.
       (If key not yet present, sets provider_voice_id='mock_' + uuid for testing).
    3. Saves record into 'voice_clones' table.
    """
    supabase = get_supabase()
    clone_id = str(uuid.uuid4())

    # 1. Upload audio sample to Supabase Storage
    storage_path = f"voice-samples/{user_id}/{clone_id}.{file_ext}"
    supabase.storage.from_("story-audio").upload(
        path=storage_path,
        file=audio_bytes,
        file_options={"content-type": f"audio/{file_ext}", "upsert": "true"}
    )
    sample_url = supabase.storage.from_("story-audio").get_public_url(storage_path)

    provider_voice_id = f"simulated_{clone_id[:8]}"
    status = "ready"

    # 2. If real ElevenLabs key is configured, call ElevenLabs API.
    # IMPORTANT: if the key IS configured but the call fails, we used to
    # silently fall back to a fake "simulated_" id and still report success -
    # the parent would see "Voice cloned!" in the app while nothing real had
    # happened, and only find out later when narration quietly played the
    # wrong (Luna) voice with zero explanation. Now a real registration
    # failure raises immediately so the actual ElevenLabs error reaches the
    # app. The silent "simulated_" fallback is kept ONLY for local dev when
    # no API key is configured at all.
    if settings.ELEVENLABS_API_KEY:
        async with httpx.AsyncClient(timeout=30.0) as client:
            files = {"files": (f"sample.{file_ext}", io.BytesIO(audio_bytes), f"audio/{file_ext}")}
            data = {
                "name": f"{label} (Parent)",
                "description": "Parent voice clone for bedtime stories",
            }
            headers = {"xi-api-key": settings.ELEVENLABS_API_KEY}
            res = await client.post(
                f"{ELEVENLABS_API_URL}/voices/add",
                headers=headers,
                data=data,
                files=files
            )
            if res.status_code in [200, 201]:
                provider_voice_id = res.json().get("voice_id", provider_voice_id)
            else:
                print(f"[ElevenLabs Warning] Code: {res.status_code}, Msg: {res.text}")
                raise RuntimeError(f"ElevenLabs rejected the voice sample (HTTP {res.status_code}): {res.text[:300]}")

    # 3. Store in voice_clones table
    from datetime import datetime, timezone
    record = {
        "id": clone_id,
        "user_id": user_id,
        "display_name": label,
        "provider": "elevenlabs",
        "provider_voice_id": provider_voice_id,
        "consent_given_at": datetime.now(timezone.utc).isoformat(),
        "status": status,
    }
    insert_res = supabase.table("voice_clones").insert(record).execute()
    return insert_res.data[0] if insert_res.data else record


async def narrate_story_with_voice_clone(
    user_id: str,
    subscription_tier: str,
    base_story_text_id: str,
    voice_clone_id: str,
    child_profile_id: Optional[str] = None,
    admin_test: bool = False
) -> Dict[str, Any]:
    """
    Narrates a story in the parent's cloned voice:
    1. Verifies parent owns the voice clone.
    2. Enforces monthly voice clone generation limit (usage_tracking).
    3. Caches result in 'personalized_stories' (strictly private to this family).
    """
    supabase = get_supabase()

    # Verify voice clone ownership
    clone_res = (
        supabase.table("voice_clones")
        .select("*")
        .eq("id", voice_clone_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not clone_res.data:
        raise ValueError("Voice clone not found or does not belong to your account.")
    clone = clone_res.data

    # Check cache at PARENT level — keyed by story + voice_clone_id only.
    # voice_clone_id already uniquely identifies the parent (no cross-parent leakage),
    # so the same cached audio is reused when the parent switches between children.
    cached = (
        supabase.table("personalized_stories")
        .select("*")
        .eq("base_story_text_id", base_story_text_id)
        .eq("voice_clone_id", voice_clone_id)
        .limit(1)
        .execute()
    )
    base = supabase.table("story_texts").select("*").eq("id", base_story_text_id).single().execute().data or {}
    base_title = base.get("title", "Bedtime Tale")
    full_text = base.get("full_text") or base.get("teaser", "")

    # Production limit: cap the narrated text at CLONED_VOICE_CHAR_LIMIT
    # characters regardless of the source story's real length. The admin
    # test account gets an even shorter cap (~1.5 min) to keep dev/testing
    # ElevenLabs cost down.
    effective_limit = ADMIN_TEST_VOICE_CLONE_CHAR_LIMIT if admin_test else CLONED_VOICE_CHAR_LIMIT
    if effective_limit:
        full_text = full_text[:effective_limit]

    from app.services.story_service import get_ambient_track_for_story
    ambient_sound = get_ambient_track_for_story(base_title, base.get("teaser", ""))

    if cached.data:
        c = cached.data[0]
        from app.services.history_service import record_story_event
        record_story_event(
            user_id=user_id,
            origin="create_clone",
            story_text_id=base_story_text_id,
            child_profile_id=child_profile_id,
            title=base_title,
            voice_clone_id=voice_clone_id,
            audio_url=c["audio_url"],
            duration_seconds=c["duration_seconds"],
            expires_at=c.get("expires_at"),
        )
        return {
            "id": c["id"],
            "child_name": c["child_name_used"],
            "full_text": c["full_text"],
            "audio_url": c["audio_url"],
            "duration_seconds": c["duration_seconds"],
            "voice_tier": "cloned",
            "ambient_sound": ambient_sound,
            "expires_at": c.get("expires_at"),
            "cached": True,
        }

    # Enforce limit (2 per month for free tier)
    allowed = check_and_increment_usage(
        user_id=user_id,
        subscription_tier=subscription_tier,
        usage_type="voice_clone_story"
    )
    if not allowed:
        raise ValueError("🎙️ Monthly limit reached! You have used your 2 monthly parent voice-clone narrations. Your limit resets next month.")

    # Determine voice gender from clone display_name
    display_name = (clone.get("display_name") or "").lower()
    is_dad = any(w in display_name for w in ["dad", "father", "papa", "male", "boy", "man"])
    voice_gender = "male" if is_dad else "female"

    # Fetch child & base story info
    child_name = "Listener"
    if child_profile_id:
        prof_res = supabase.table("child_profiles").select("name").eq("id", child_profile_id).execute()
        if prof_res.data:
            child_name = prof_res.data[0].get("name", "Listener")
    else:
        # Check if user already has any profile, or create hidden system profile to satisfy NOT NULL constraint on child_profile_id
        existing_prof = supabase.table("child_profiles").select("id, name").eq("user_id", user_id).limit(1).execute()
        if existing_prof.data:
            child_profile_id = existing_prof.data[0]["id"]
            child_name = existing_prof.data[0].get("name", "Listener")
        else:
            new_prof = supabase.table("child_profiles").insert({
                "user_id": user_id,
                "name": "_system_hidden",
                "age_group_id": base["age_group_id"],
                "language_id": base["language_id"],
                "sleep_timer_minutes": 20
            }).execute()
            if new_prof.data:
                child_profile_id = new_prof.data[0]["id"]
                child_name = "Listener"

    # Synthesize audio using ElevenLabs (cloned voice if available, else best premade voice)
    audio_bytes = None
    voice_id = clone.get("provider_voice_id", "")

    # ElevenLabs premade voices — best choices for a warm bedtime Dad/Mom voice
    ELEVENLABS_DAD_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"   # George – Warm, Captivating Storyteller
    ELEVENLABS_MOM_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"   # Sarah – Mature, Reassuring, Confident

    # Try to auto-register with ElevenLabs if cloning key available and voice is still simulated
    if settings.ELEVENLABS_API_KEY and voice_id.startswith("simulated_"):
        try:
            sample_data = None
            try:
                sample_data = supabase.storage.from_("story-audio").download(
                    f"voice-samples/{user_id}/{clone['id']}.webm"
                )
            except Exception:
                pass
            if not sample_data:
                try:
                    sample_data = supabase.storage.from_("story-audio").download(
                        f"voice-samples/{user_id}/{clone['id']}.mp3"
                    )
                except Exception:
                    pass

            if sample_data:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    files = {"files": ("sample.webm", io.BytesIO(sample_data), "audio/webm")}
                    data = {
                        "name": f"{clone.get('display_name', 'Parent')} (Bedtime)",
                        "description": "Parent voice clone for bedtime stories",
                    }
                    headers = {"xi-api-key": settings.ELEVENLABS_API_KEY}
                    v_res = await client.post(f"{ELEVENLABS_API_URL}/voices/add", headers=headers, data=data, files=files)
                    if v_res.status_code in [200, 201]:
                        voice_id = v_res.json().get("voice_id", voice_id)
                        supabase.table("voice_clones").update({"provider_voice_id": voice_id}).eq("id", clone["id"]).execute()
                        print(f"[ElevenLabs Success] Registered real voice clone: {voice_id}")
                    else:
                        print(f"[ElevenLabs Notice] Voice cloning unavailable (plan restriction): {v_res.status_code}")
                        # Fall through to use best premade voice below
        except Exception as ex:
            print(f"[ElevenLabs Exception registering voice] {ex}")

    # Use real cloned voice_id if we got one, otherwise use best ElevenLabs premade voice
    if settings.ELEVENLABS_API_KEY:
        # Pick the right voice: real clone if available, else best premade dad/mom voice
        tts_voice_id = voice_id if not voice_id.startswith("simulated_") else (
            ELEVENLABS_DAD_VOICE_ID if voice_gender == "male" else ELEVENLABS_MOM_VOICE_ID
        )
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                res = await client.post(
                    f"{ELEVENLABS_API_URL}/text-to-speech/{tts_voice_id}",
                    headers={"xi-api-key": settings.ELEVENLABS_API_KEY, "Content-Type": "application/json"},
                    json={
                        "text": full_text[:4800],
                        # Cheapest model, app-wide - see ELEVENLABS_TTS_MODEL_ID above.
                        "model_id": ELEVENLABS_TTS_MODEL_ID,
                        "voice_settings": {
                            "stability": 0.65,
                            "similarity_boost": 0.80
                        }
                    }
                )
                if res.status_code == 200:
                    audio_bytes = res.content
                    is_real_clone = not tts_voice_id.startswith("simulated_") and tts_voice_id not in [ELEVENLABS_DAD_VOICE_ID, ELEVENLABS_MOM_VOICE_ID]
                    print(f"[ElevenLabs TTS] Used {'real clone' if is_real_clone else 'best premade voice'} ({tts_voice_id}), {len(audio_bytes)} bytes")
                else:
                    print(f"[ElevenLabs TTS Error] Status: {res.status_code}, {res.text[:300]}")
        except Exception as e:
            print(f"[ElevenLabs TTS Exception] {e}")

    if not audio_bytes:
        # Fallback to Google Cloud TTS bedtime narrator matching Dad/Mom.
        # synthesize_story_audio() takes a NARRATOR_VOICES key (e.g. "oliver",
        # "luna"), not a raw gender string - map the clone's inferred gender
        # to the closest-matching narrator voice.
        fallback_voice_id = "oliver" if voice_gender == "male" else "luna"
        audio_bytes, duration_seconds = synthesize_story_audio(full_text, "en", voice_id=fallback_voice_id)
    else:
        # Approximate duration
        duration_seconds = max(60, int(len(full_text.split()) / 2.2))

    # Save to Supabase Storage
    sub_folder = child_profile_id or f"parent_{user_id}"
    storage_path = f"personalized/{sub_folder}/cloned_{base_story_text_id}_{voice_clone_id}.mp3"
    supabase.storage.from_("story-audio").upload(
        path=storage_path,
        file=audio_bytes,
        file_options={"content-type": "audio/mpeg", "upsert": "true"}
    )
    audio_url = supabase.storage.from_("story-audio").get_public_url(storage_path)

    insert_payload = {
        "child_profile_id": child_profile_id,
        "base_story_text_id": base_story_text_id,
        "category_id": base["category_id"],
        "age_group_id": base["age_group_id"],
        "language_id": base["language_id"],
        "child_name_used": child_name,
        "full_text": full_text,
        "voice_tier": "deluxe",
        "voice_clone_id": voice_clone_id,
        "audio_url": audio_url,
        "duration_seconds": duration_seconds,
        "safety_check_status": "passed",
    }
    expires_at = _story_expiry_iso(supabase, user_id)
    try:
        insert_res = supabase.table("personalized_stories").insert({**insert_payload, "expires_at": expires_at}).execute()
    except Exception as e:
        # expires_at column not added yet (SQL 008 not run): still save the story.
        print(f"[cloned story] saving without expiry ({e})")
        expires_at = None
        insert_res = supabase.table("personalized_stories").insert(insert_payload).execute()
    new_record = insert_res.data[0] if insert_res.data else insert_payload

    from app.services.history_service import record_story_event
    record_story_event(
        user_id=user_id,
        origin="create_clone",
        story_text_id=base_story_text_id,
        child_profile_id=child_profile_id,
        title=base_title,
        voice_clone_id=voice_clone_id,
        audio_url=audio_url,
        duration_seconds=duration_seconds,
        expires_at=expires_at,
    )

    return {
        "id": new_record.get("id"),
        "child_name": child_name,
        "full_text": full_text,
        "audio_url": audio_url,
        "duration_seconds": duration_seconds,
        "voice_tier": "cloned",
        "ambient_sound": ambient_sound,
        "expires_at": expires_at,
        "cached": False,
    }



def _is_admin_user(supabase, user_id: str) -> bool:
    """True for the admin/owner account(s): their cloned voices are never auto-deleted."""
    try:
        from app.auth import ADMIN_EMAILS
        r = supabase.table("users").select("email, subscription_tier").eq("id", user_id).limit(1).execute()
        if not r.data:
            return False
        u = r.data[0]
        return (u.get("email") or "").lower().strip() in {e.lower() for e in ADMIN_EMAILS} or \
            (u.get("subscription_tier") or "") in ("admin", "admin_vip", "superadmin")
    except Exception as e:
        # If we cannot tell, do NOT delete: keeping a voice is the safe side.
        print(f"[voice clone] admin check failed, keeping voice: {e}")
        return True


def delete_clone_everywhere(supabase, clone: dict) -> None:
    """Removes a clone from ElevenLabs, deletes the stored sample and the database row."""
    import httpx as _httpx
    vid = clone.get("provider_voice_id") or ""
    if settings.ELEVENLABS_API_KEY and vid and not vid.startswith(("simulated_", "mock_")):
        try:
            _httpx.delete(f"{ELEVENLABS_API_URL}/voices/{vid}", headers={"xi-api-key": settings.ELEVENLABS_API_KEY}, timeout=20.0)
        except Exception as e:
            print(f"[voice clone] ElevenLabs delete failed for {vid}: {e}")
    try:
        folder = f"voice-samples/{clone['user_id']}"
        names = [f["name"] for f in (supabase.storage.from_("story-audio").list(folder) or []) if f.get("name", "").startswith(clone["id"])]
        if names:
            supabase.storage.from_("story-audio").remove([f"{folder}/{n}" for n in names])
    except Exception as e:
        print(f"[voice clone] sample cleanup failed: {e}")
    supabase.table("voice_clones").delete().eq("id", clone["id"]).execute()


def purge_expired_cloned_stories() -> int:
    """
    Deletes every cloned-voice story whose 10-day window is over: the audio file,
    the saved story row and its History entry. Cloned voices themselves are never
    touched here, and admin stories are skipped. Returns how many were removed.
    """
    from datetime import datetime, timezone
    supabase = get_supabase()
    now = datetime.now(timezone.utc).isoformat()
    rows = supabase.table("personalized_stories").select("*").lt("expires_at", now).execute().data or []
    removed = 0
    for r in rows:
        try:
            owner = None
            if r.get("voice_clone_id"):
                c = supabase.table("voice_clones").select("user_id").eq("id", r["voice_clone_id"]).limit(1).execute().data
                owner = c[0]["user_id"] if c else None
            if owner and _is_admin_user(supabase, owner):
                supabase.table("personalized_stories").update({"expires_at": None}).eq("id", r["id"]).execute()
                continue
            url = r.get("audio_url") or ""
            if "/story-audio/" in url:
                path = url.split("/story-audio/", 1)[1].split("?", 1)[0]
                try:
                    supabase.storage.from_("story-audio").remove([path])
                except Exception as e:
                    print(f"[cloned story] audio cleanup failed: {e}")
            if url:
                try:
                    supabase.table("story_events").delete().eq("audio_url", url).execute()
                except Exception:
                    pass
            supabase.table("personalized_stories").delete().eq("id", r["id"]).execute()
            removed += 1
        except Exception as e:
            print(f"[cloned story] purge failed for {r.get('id')}: {e}")
    return removed
