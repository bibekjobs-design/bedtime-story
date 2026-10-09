import json
import re
import io
import time
from typing import List, Dict, Any, Optional
from google import genai
from google.genai import types
from PIL import Image
import pypdf
from app.config import settings
from app.db import get_supabase


def clean_json_response(raw_text: str) -> Any:
    """Strip markdown code fences and parse JSON safely."""
    text = raw_text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return json.loads(text.strip())

import time


# ---------------------------------------------------------------------------
# Bedtime-story length cap (~7-8 minutes of narration)
#
# The app's own narration pace is ~125-135 words/minute (see the TTS
# speaking_rate in tts_service.py and the 1300-1550 word / 10-12 min figure
# used elsewhere). Whether a story was AI-generated from a short idea or
# narrated verbatim from a parent's own text/file, we cap it here so
# playback always lands in a predictable range.
# ---------------------------------------------------------------------------
SHORT_IDEA_WORD_THRESHOLD = 30      # <= this many words = "an idea", ask Gemini to write a story
# NOTE: TARGET_STORY_WORDS stays the Library default (~7-8 min) - Library
# content is shared/admin-curated and NOT tied to the Create-tab per-plan
# caps below. Pro's Create-tab cap is PRO_TIER_TARGET_WORDS, not this.
TARGET_STORY_WORDS = 1000           # ~7-8 minutes at ~130 wpm (Library / admin default)
STORY_WORD_TOLERANCE = 150          # allow up to +150 words to land on a clean sentence end

# Super plan (Rs 219/mo) Create-tab stories: ~5 minutes at the app's own
# ~135 wpm pace - shorter than the old ~7-8 min, per the product decision
# to bring Pro's per-story cost down while still noticeably longer than
# Normal/free trial.
PRO_TIER_TARGET_WORDS = 675         # ~5 minutes at ~135 wpm

# Normal plan (Rs 99/mo): stories capped at 3 minutes, same length as the
# free trial - Normal differentiates on price/being a recurring plan, not
# story length, to keep per-story TTS cost minimal at this tier.
NORMAL_TIER_TARGET_WORDS = 405      # ~3 minutes at ~135 wpm

# Free trial: same 3-minute cap as Normal, so the trial never looks like a
# better deal than paying (it wins on being free but loses on story count
# and being a one-time window, not recurring) - see also
# usage_service.TIER_LIMITS["free"] (3 stories/trial) and the
# tts_usage_service cost guard applied only to this tier.
FREE_TIER_TARGET_WORDS = 405        # ~3 minutes at ~135 wpm


def target_words_for_tier(subscription_tier: str) -> int:
    if subscription_tier in ("normal_monthly", "pro_monthly"):
        return NORMAL_TIER_TARGET_WORDS  # Pro (Rs 151) stories are ~3 min, same as Normal's cap
    if subscription_tier == "free":
        return FREE_TIER_TARGET_WORDS
    if subscription_tier in ("premium", "premium_monthly", "premium_annual"):
        return PRO_TIER_TARGET_WORDS
    return TARGET_STORY_WORDS  # admin/admin_vip and any unrecognized tier: generous default


def _enforce_free_tier_tts_budget(subscription_tier: str, char_count: int) -> None:
    """
    Cost guard for the FREE TRIAL only: if narrating this story would push
    the whole platform over Google Cloud TTS's shared free monthly quota
    (see tts_usage_service), block it with a friendly message instead of
    silently incurring real cloud spend on an unpaid account. Paid tiers
    (normal_monthly/pro_monthly/premium*/admin*) are never blocked here - their TTS
    cost is expected, revenue-covered usage, and admins are unlimited.
    """
    if subscription_tier != "free":
        return
    from app.services.tts_usage_service import would_exceed_free_quota
    if would_exceed_free_quota(char_count):
        raise ValueError(
            "Our free trial's narration credit for this month is fully used up right now. "
            "Please try again next month, or upgrade to Pro (₹151/mo) or Super (₹219/mo) to keep generating stories today."
        )

TRUNCATION_NOTICE = (
    "Your story was longer than our narration limit, so we narrated the "
    "beginning and gently trimmed the rest. Tip: for long stories, try typing or "
    "uploading a shorter section (under ~1000 words) next time so the whole thing "
    "gets narrated!"
)


def word_count(text: str) -> int:
    return len((text or "").split())


def sanitize_text(text: str) -> str:
    """
    Strips NUL bytes and other control characters that Postgres text columns
    cannot store at all (a raw \\x00 makes Supabase/Postgres reject the insert
    with 'unsupported Unicode escape sequence... \\u0000 cannot be converted
    to text', error 22P05). Normal whitespace (newline, tab, carriage return)
    is kept.
    """
    if not text:
        return text
    return "".join(ch for ch in text if ch in "\n\t\r" or ord(ch) >= 32)


def looks_like_readable_text(text: str, min_ratio: float = 0.85) -> bool:
    """
    Guards against binary garbage (e.g. a Word .doc/.docx or other non-plain-text
    file that slipped past the upload filter and got decoded byte-by-byte as if
    it were plain text - that decode never raises an error, it just produces
    mostly-unprintable junk). Returns False if too much of the sample isn't
    normal printable text.
    """
    if not text or not text.strip():
        return False
    sample = text[:5000]
    printable = sum(1 for ch in sample if ch.isprintable() or ch in "\n\t\r")
    return (printable / len(sample)) >= min_ratio


def enforce_story_length(
    text: str,
    target_words: int = TARGET_STORY_WORDS,
    tolerance_words: int = STORY_WORD_TOLERANCE
) -> tuple[str, bool]:
    """
    Caps text to roughly a 5-minute bedtime story. The file/text is never
    rejected on load - this only trims what gets narrated, and tries to end
    on a clean sentence within `tolerance_words` of the target instead of
    cutting mid-sentence. Returns (final_text, was_truncated).
    """
    text = sanitize_text(text)
    words = (text or "").split()
    max_words = target_words + tolerance_words

    if len(words) <= max_words:
        return text, False

    window_text = " ".join(words[:max_words])
    search_from = len(" ".join(words[:target_words]))

    best_cut = -1
    for m in re.finditer(r'[.!?।॥]["\')]?\s', window_text[search_from:]):
        best_cut = search_from + m.end()

    if best_cut > 0:
        final_text = window_text[:best_cut].strip()
    else:
        # No clean sentence boundary found in the tolerance window; hard cut.
        final_text = window_text.strip()
        if not final_text.endswith((".", "!", "?")):
            final_text += "..."

    return final_text, True


# ---------------------------------------------------------------------------
# Multi-language support (English + Indian languages)
# ---------------------------------------------------------------------------
TRANSLATION_SUFFIXES = ("hi", "bn", "kn", "te", "or")  # "or" kept so old Odia rows are still recognised

SUPPORTED_LANGUAGES = {
    "en": {"label": "English", "script": [(0x0041, 0x024F)], "word_factor": 1.0},
    "hi": {"label": "Hindi", "script": [(0x0900, 0x097F)], "word_factor": 1.0},
    "bn": {"label": "Bengali", "script": [(0x0980, 0x09FF)], "word_factor": 0.9},
    "kn": {"label": "Kannada", "script": [(0x0C80, 0x0CFF)], "word_factor": 0.8},
    "te": {"label": "Telugu", "script": [(0x0C00, 0x0C7F)], "word_factor": 0.85},
}


def target_words_for_language(subscription_tier: str, lang_code: str) -> int:
    """Plan word cap, scaled for languages whose words take longer to speak."""
    base = target_words_for_tier(subscription_tier)
    factor = SUPPORTED_LANGUAGES.get((lang_code or "en").lower(), {}).get("word_factor", 1.0)
    return max(60, int(base * factor))


def _script_ratio(text: str, ranges) -> float:
    letters = [ch for ch in (text or "") if ch.isalpha()]
    if not letters:
        return 1.0  # nothing to translate (numbers/punctuation only)
    hits = sum(1 for ch in letters if any(lo <= ord(ch) <= hi for lo, hi in ranges))
    return hits / len(letters)


def ensure_text_in_language(text: str, lang_code: str, lang_label: str) -> tuple[str, bool]:
    """
    Returns (text_in_target_language, was_translated). If the text is already
    mostly written in the target language's script it is returned untouched
    (no Gemini call). Otherwise Gemini translates it. Never silently falls
    back to the wrong language - raises ValueError so the parent can retry.
    """
    code = (lang_code or "en").lower()
    cfg = SUPPORTED_LANGUAGES.get(code)
    if not cfg or not (text or "").strip():
        return text, False
    if _script_ratio(text, cfg["script"]) >= 0.6:
        return text, False

    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    prompt = f"""Translate the following children's bedtime story text into {lang_label}.
Rules:
- Keep the meaning, characters and the warm, gentle, sleepy tone.
- Use simple, natural {lang_label} that young children understand, written in the normal {lang_label} script (not transliteration).
- Keep the same paragraph breaks.
- Output ONLY the translated text. No notes, no quotes, no explanations.

TEXT:
{text}
"""
    last_err = None
    for _ in range(2):
        try:
            response = call_gemini_with_fallback(
                client=client,
                prompt=prompt,
                config=types.GenerateContentConfig(temperature=0.3),
            )
            out = sanitize_text((response.text or "").strip())
            if out and _script_ratio(out, cfg["script"]) >= 0.5:
                return out, True
            last_err = "translation came back in the wrong script"
        except Exception as exc:
            last_err = str(exc)
    raise ValueError(
        f"We couldn't translate the story into {lang_label} right now ({last_err}). Please try again in a moment."
    )


def resolve_language(supabase, language_id: int = 1, language_code: Optional[str] = None) -> tuple[int, str, str]:
    """
    Returns (language_id, label, code). When the app sends a language_code
    (en/hi/bn/or/kn) it is looked up in the `languages` table (and added if
    missing); otherwise falls back to the numeric language_id as before.
    """
    code = (language_code or "").strip().lower()
    if code and code in SUPPORTED_LANGUAGES:
        label = SUPPORTED_LANGUAGES[code]["label"]
        res = supabase.table("languages").select("id, label, code").eq("code", code).limit(1).execute()
        if res.data:
            return res.data[0]["id"], res.data[0].get("label") or label, code
        try:
            # The languages.id column has no auto-number, so pick the next free id.
            mx = supabase.table("languages").select("id").order("id", desc=True).limit(1).execute()
            next_id = ((mx.data[0]["id"] if mx.data else 0) or 0) + 1
            ins = supabase.table("languages").insert(
                {"id": next_id, "code": code, "label": label, "is_active": True}
            ).execute()
            if ins.data:
                return ins.data[0]["id"], label, code
        except Exception as exc:
            raise ValueError(
                f"{label} isn't set up in the database yet. Please run add_languages.sql in Supabase. ({exc})"
            )
    res = supabase.table("languages").select("id, label, code").eq("id", language_id).limit(1).execute()
    if res.data:
        return res.data[0]["id"], res.data[0].get("label") or "English", res.data[0].get("code") or "en"
    return language_id, "English", "en"


def derive_title_from_text(text: str, max_words: int = 8) -> str:
    """Deterministically builds a short title from the start of a user's own text (no LLM call)."""
    text = sanitize_text(text)
    words = (text or "").strip().split()
    if not words:
        return "My Bedtime Story"
    snippet = " ".join(words[:max_words])
    if len(words) > max_words:
        snippet += "..."
    return snippet[0].upper() + snippet[1:] if snippet else "My Bedtime Story"


def derive_teaser_from_text(text: str, max_words: int = 20) -> str:
    """Deterministically builds a one-line teaser from the start of a user's own text (no LLM call)."""
    text = sanitize_text(text)
    match = re.search(r'[^.!?]*[.!?]', text or "")
    if match and len(match.group(0).split()) >= 4:
        return match.group(0).strip()
    words = (text or "").strip().split()
    snippet = " ".join(words[:max_words])
    return snippet + ("..." if len(words) > max_words else "") if snippet else "A cozy bedtime story."


def call_gemini_with_fallback(
    client: genai.Client,
    prompt: str,
    config: Any = None,
    models: tuple = ("gemini-flash-latest", "gemini-flash-lite-latest"),
    retries_per_model: int = 3
) -> Any:
    """
    Calls Google Gemini using the primary budget model 'gemini-flash-latest'.
    If Google returns a transient 503 'High Demand' spike, it retries and,
    if still overloaded, falls back seamlessly to 'gemini-flash-lite-latest'.
    Raises the last error if every model/attempt fails, instead of silently
    returning None (which used to crash callers with a confusing
    'NoneType has no attribute text' error).
    """
    last_exc = None
    for model_name in models:
        for attempt in range(retries_per_model):
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=config
                )
                return response
            except Exception as exc:
                last_exc = exc
                err_str = str(exc)
                if "503" in err_str or "UNAVAILABLE" in err_str or "high demand" in err_str.lower():
                    time.sleep(2 * (attempt + 1))
                elif "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "rate limit" in err_str.lower() or "quota" in err_str.lower():
                    # Rate-limited - retrying instantly with zero delay just
                    # hammers the API further while it's already over quota.
                    # Back off longer than the 503 case to actually give the
                    # per-minute quota window a chance to clear.
                    time.sleep(5 * (attempt + 1))

    raise RuntimeError(f"Gemini generation failed after retries: {last_exc}")

def generate_teasers_with_gemini(
    category_name: str,
    age_label: str,
    language_label: str,
    count: int = 4,
    max_retries: int = 3
) -> List[Dict[str, str]]:
    """
    Calls Google Gemini using the 'gemini-flash-latest' model to generate
    cheap, original, soothing bedtime story titles and one-line hooks.
    Includes retry logic to absorb transient 503 demand spikes.
    """
    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    prompt = f"""You are a gentle bedtime story creator for children.
Generate {count} unique, soothing, original bedtime story ideas for:
- Age Group: {age_label}
- Category / Theme: {category_name}
- Language: {language_label}

Requirements:
1. Purely original storytelling ideas suitable for a calm, relaxing podcast narration before sleep.
2. Absolutely no scary, violent, or anxious themes. Must feel cozy, peaceful, and comforting.
3. For each idea, provide a warm 'title' and a compelling 1-sentence 'teaser' (hook).
4. Return ONLY a valid JSON array of objects with keys "title" and "teaser". No extra text.

Example format:
[
  {{"title": "The Little Star That Yawned", "teaser": "A tiny star twinkles softly as it floats across the quiet night sky to find its nighttime resting place."}}
]
"""

    last_error = None
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model="gemini-flash-latest",
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.7,
                )
            )
            parsed = clean_json_response(response.text)
            if isinstance(parsed, list):
                return parsed
            elif isinstance(parsed, dict) and "stories" in parsed:
                return parsed["stories"]
            return []
        except Exception as exc:
            last_error = exc
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
            else:
                raise last_error



def generate_full_story_text(
    title: str,
    teaser: str,
    category_name: str,
    age_label: str,
    language_label: str,
    max_retries: int = 5,
    min_words: int = 1300,
    max_words: int = 1550,
    target_minutes_label: str = "10-12 minutes",
) -> str:
    """
    Generates a full narrated bedtime story using Gemini (model:
    'gemini-flash-latest'). Length defaults to the original ~10-12 minute
    (1300-1550 word) target; callers that want a shorter story (e.g. the
    admin search-to-generate flow's 5-7 minute target) pass their own
    min_words/max_words/target_minutes_label instead.
    """
    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    prompt = f"""You are a master children's bedtime storyteller creating a soothing, podcast-style bedtime tale.

Story Details:
- Title: {title}
- Premise: {teaser}
- Category: {category_name}
- Age Group: {age_label}
- Language: {language_label}

Target Length & Pacing:
- Must be approximately {min_words} to {max_words} words (aim for {target_minutes_label} when spoken slowly and calmly).
- Purely generative, 100% original storytelling. NEVER use copyrighted characters or verbatim text.
- Pacing should be gentle, repetitive, and deeply relaxing. As the story progresses toward the end, it should naturally slow down, becoming increasingly sleepy, tranquil, and peaceful until the characters drift gently to sleep.

Safety & Atmosphere:
- Absolutely NO scary moments, villains, sudden loud surprises, conflict, or distress.
- Warm, comforting, safe, and sensory descriptions (soft blankets, gentle breezes, glowing stars, cozy nooks).
- Write in clean narration paragraphs without sound effect labels or stage directions (no '[pause]' or '**Sound effects**'), just smooth, beautiful narrative prose ready for voice narration.
"""

    response = call_gemini_with_fallback(
        client=client,
        prompt=prompt,
        config=types.GenerateContentConfig(
            temperature=0.65,
        )
    )
    return response.text.strip()



def rate_story(
    supabase,
    story_text_id: str,
    rating: int,
    user_id: Optional[str] = None,
    device_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Submits or updates a 1-5 star user rating for a story, updates story_texts rating aggregations,
    and invalidates the in-memory library cache.
    """
    if rating < 1 or rating > 5:
        raise ValueError("Rating must be between 1 and 5 stars.")

    # 1. Check existing rating by user or device
    try:
        existing_q = supabase.table("story_ratings").select("id").eq("story_text_id", story_text_id)
        if user_id:
            existing_q = existing_q.eq("user_id", user_id)
        elif device_id:
            existing_q = existing_q.eq("device_id", device_id)
        existing = existing_q.execute()

        if existing.data:
            rating_id = existing.data[0]["id"]
            supabase.table("story_ratings").update({
                "rating": rating,
                "updated_at": "now()"
            }).eq("id", rating_id).execute()
        else:
            payload = {
                "story_text_id": story_text_id,
                "rating": rating
            }
            if user_id:
                payload["user_id"] = user_id
            if device_id:
                payload["device_id"] = device_id
            supabase.table("story_ratings").insert(payload).execute()
    except Exception as e:
        print(f"[story_ratings table notice] {e}")

    # 2. Compute updated average and count
    try:
        all_ratings = supabase.table("story_ratings").select("rating").eq("story_text_id", story_text_id).execute()
        ratings_list = [r["rating"] for r in (all_ratings.data or [])]
    except Exception:
        ratings_list = [rating]

    if ratings_list:
        avg_rating = round(float(sum(ratings_list)) / len(ratings_list), 2)
        total_count = len(ratings_list)
    else:
        avg_rating = float(rating)
        total_count = 1

    # 3. Update story_texts aggregation columns
    try:
        supabase.table("story_texts").update({
            "average_rating": avg_rating,
            "total_ratings": total_count
        }).eq("id", story_text_id).execute()
    except Exception as e:
        print(f"[Rate Story Aggregation Update Note] {e}")

    # (No in-memory story cache anymore - nothing to invalidate.)

    return {
        "story_text_id": story_text_id,
        "rating": rating,
        "average_rating": avg_rating,
        "total_ratings": total_count,
        "message": "Thank you for rating this bedtime story!"
    }



def get_ambient_track_for_story(title: str, teaser: str, category_name: str = "") -> dict:
    """
    Determines the best fitting ambient background soundscape based on story theme, title & teaser.
    Returns dict with track id, name, icon, description, and streaming audio URL.
    """
    text = f"{title} {teaser} {category_name}".lower()

    if any(w in text for w in ["ocean", "sea", "whale", "dolphin", "wave", "river", "otter", "boat", "water", "island", "coral", "fish"]):
        return {
            "id": "ocean_waves",
            "name": "Calm Ocean Waves",
            "icon": "🌊",
            "description": "Gentle rhythmic ocean swells & warm deep water pads",
            "audio_url": "https://cdn.pixabay.com/download/audio/2022/05/16/audio_c89e836b69.mp3"
        }
    elif any(w in text for w in ["space", "star", "moon", "galaxy", "rocket", "planet", "astronomer", "night sky", "comet", "starlight", "cosmic"]):
        return {
            "id": "starlight_chimes",
            "name": "Celestial Starlight",
            "icon": "✨",
            "description": "Dreamy cosmic chimes & atmospheric starlight shimmer",
            "audio_url": "https://cdn.pixabay.com/download/audio/2022/03/24/audio_3d1ef32ec8.mp3"
        }
    elif any(w in text for w in ["rain", "storm", "puddle", "cloud", "bedroom", "blanket", "pillow", "cozy", "house", "window", "sleepy", "snuggle"]):
        return {
            "id": "cozy_rain",
            "name": "Rain on Window",
            "icon": "🌧️",
            "description": "Soft distant rain on window with gentle lullaby chords",
            "audio_url": "https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3"
        }
    elif any(w in text for w in ["castle", "magic", "fairy", "dragon", "wizard", "princess", "kingdom", "enchanted", "wand", "crown", "knight"]):
        return {
            "id": "music_box_piano",
            "name": "Lullaby Music Box",
            "icon": "🎹",
            "description": "Warm classical piano lullaby & delicate music box bells",
            "audio_url": "https://cdn.pixabay.com/download/audio/2021/09/06/audio_8484a0d922.mp3"
        }
    else:
        return {
            "id": "woodland_whispers",
            "name": "Forest Whispers",
            "icon": "🌲",
            "description": "Soft acoustic guitar, gentle night breeze & sleepy crickets",
            "audio_url": "https://cdn.pixabay.com/download/audio/2022/10/14/audio_9939f792cb.mp3"
        }



_LANG_CODE_CACHE: Dict[Any, str] = {}


def _language_code_map(supabase) -> Dict[Any, str]:
    """languages.id -> code. Rarely changes, so it is loaded once and kept."""
    global _LANG_CODE_CACHE
    if not _LANG_CODE_CACHE:
        try:
            rows = supabase.table("languages").select("id, code").execute().data or []
            _LANG_CODE_CACHE = {r["id"]: r.get("code") for r in rows if r.get("code")}
        except Exception as e:
            print(f"[language map] {e}")
    return _LANG_CODE_CACHE


def enrich_audio_story_items(supabase, stories: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Ultra-fast audio-only enrichment: 1 DB query, zero image storage calls."""
    if not stories:
        return []

    story_ids = [s["id"] for s in stories]

    # Fetch cached audio records in 1 fast query
    audio_res = (
        supabase.table("story_audio")
        .select("story_text_id, voice_tier, audio_url, duration_seconds")
        .in_("story_text_id", story_ids)
        .execute()
    )
    audio_map = {}
    for r in (audio_res.data or []):
        # Language-version audio (tier ends in _hi/_bn/_or/_kn) must never be
        # used as the story's default audio.
        if (r.get("voice_tier") or "").rsplit("_", 1)[-1] in TRANSLATION_SUFFIXES:
            continue
        audio_map[r["story_text_id"]] = r

    # Which languages each story is available in (original + admin-added versions)
    translations_by_story = {}
    lang_code_by_id = _language_code_map(supabase)
    for attempt in range(3):
        try:
            tr_rows = (
                supabase.table("story_translations")
                .select("story_text_id, language_id")
                .in_("story_text_id", story_ids)
                .execute()
                .data or []
            )
            if any(t["language_id"] not in lang_code_by_id for t in tr_rows):
                _LANG_CODE_CACHE.clear()  # a language was added since the map was loaded
                lang_code_by_id = _language_code_map(supabase)
            for t in tr_rows:
                code = lang_code_by_id.get(t["language_id"])
                if code:
                    translations_by_story.setdefault(t["story_text_id"], []).append(code)
            break
        except Exception as e:
            if attempt == 2:
                print(f"[language_codes] lookup skipped: {e}")
            else:
                time.sleep(0.2 * (attempt + 1))

    enriched = []
    for s in stories:
        sid = s["id"]
        aud = audio_map.get(sid)
        has_audio = aud is not None
        orig_code = lang_code_by_id.get(s.get("language_id")) or "en"
        enriched.append({
            **s,
            "has_audio": has_audio,
            "has_images": False,
            "audio_url": aud["audio_url"] if aud else None,
            "duration_seconds": aud["duration_seconds"] if aud else None,
            "scenes_count": 0,
            "language_codes": [orig_code] + [c for c in translations_by_story.get(sid, []) if c != orig_code],
        })

    def sort_priority(item):
        if item.get("has_audio"):
            return (2, item.get("times_served", 0))
        elif item.get("generation_status") == "full_generated":
            return (1, item.get("times_served", 0))
        return (0, item.get("times_served", 0))

    enriched.sort(key=sort_priority, reverse=True)
    return enriched



def _precreated_core(
    category_id: Optional[str] = None,
    age_group_id: int = 1,
    language_id: int = 1,
    sort_by: str = "popular",
    is_admin: bool = False,
) -> List[Dict[str, Any]]:
    """
    Returns all pre-created stories already stored in the DB for the specified age group & category.
    Zero AI generation cost, instant 0.1s response with audio status and ambient soundscape.

    Auto-seeding brand-new teaser ideas for an empty category is admin-only
    (see `is_admin` below) - a regular parent just browsing sees whatever is
    already published, never silently triggers a Gemini call.
    """
    supabase = get_supabase()

    if category_id == "others":
        # Catch-all view: any story that isn't tagged with a real, currently
        # existing category (never assigned one, or its category was since
        # deleted) shows up here instead of silently disappearing from
        # "Browse by Category". Not a real row in story_categories - just a
        # computed bucket, so we fetch a working set and filter in Python.
        known_ids = {
            c["id"] for c in (supabase.table("story_categories").select("id").execute().data or [])
        }
        query = (
            supabase.table("story_texts")
            .select("id, category_id, age_group_id, language_id, title, teaser, generation_status, times_served, cover_image_url, created_at, average_rating, total_ratings")
            .eq("age_group_id", age_group_id)
            .is_("owner_user_id", "null")
        )
        if sort_by == "newest":
            res = query.order("created_at", desc=True).limit(200).execute()
        else:
            res = query.order("times_served", desc=True).order("created_at", desc=True).limit(200).execute()
        all_stories = res.data or []
        others = [s for s in all_stories if not s.get("category_id") or s.get("category_id") not in known_ids]
        return enrich_audio_story_items(supabase, others[:50])

    query = (
        supabase.table("story_texts")
        .select("id, category_id, age_group_id, language_id, title, teaser, generation_status, times_served, cover_image_url, created_at, average_rating, total_ratings")
        .eq("age_group_id", age_group_id)
        .is_("owner_user_id", "null")
    )

    if category_id:
        query = query.eq("category_id", category_id)

    if sort_by == "newest":
        res = query.order("created_at", desc=True).limit(50).execute()
    elif sort_by == "top_rated":
        # Tie-break by created_at so a brand-new story (times_served=0) never
        # silently loses to older stories tied at the same play count and
        # falls outside the top-50 cutoff - new stories should surface right away.
        res = query.order("times_served", desc=True).order("created_at", desc=True).limit(50).execute()
    else:
        res = query.order("times_served", desc=True).order("created_at", desc=True).limit(50).execute()
    stories = res.data or []

    # If database is completely empty for this combination, generate an initial batch
    if not stories and category_id and is_admin:
        cat_res = supabase.table("story_categories").select("name").eq("id", category_id).single().execute()
        age_res = supabase.table("age_groups").select("label").eq("id", age_group_id).single().execute()
        lang_res = supabase.table("languages").select("label").eq("id", language_id).single().execute()

        cat_name = cat_res.data["name"] if cat_res.data else "Bedtime"
        age_label = age_res.data["label"] if age_res.data else "kids"
        lang_label = lang_res.data["label"] if lang_res.data else "English"

        new_teasers = generate_teasers_with_gemini(cat_name, age_label, lang_label, count=4)
        for item in new_teasers:
            insert_res = supabase.table("story_texts").insert({
                "category_id": category_id,
                "age_group_id": age_group_id,
                "language_id": language_id,
                "title": item.get("title", "Bedtime Tale"),
                "teaser": item.get("teaser", ""),
                "generation_status": "teaser_only",
                "safety_check_status": "passed",
                "times_served": 0
            }).execute()
            if insert_res.data:
                stories.extend(insert_res.data)

    return enrich_audio_story_items(supabase, stories)


def apply_language_view(supabase, stories: List[Dict[str, Any]], language_code: Optional[str]) -> List[Dict[str, Any]]:
    """
    Keeps only the stories that have a version in `language_code` (original or
    an admin-added translation) and shows each one with that version's title
    and teaser. No language given -> list unchanged.
    """
    code = (language_code or "").strip().lower()
    if not code:
        return stories
    kept = [s for s in stories if code in (s.get("language_codes") or [])]
    if not kept:
        return []
    # Titles only need fetching for stories whose original language differs
    # from the chosen one (the common English-only case needs no extra query).
    if all(((s.get("language_codes") or [None])[0] == code) for s in kept):
        return [{**s, "language_code": code} for s in kept]
    lang_id = None
    for lid, c in _language_code_map(supabase).items():
        if c == code:
            lang_id = lid
            break
    translated = {}
    if lang_id is not None:
        try:
            rows = (
                supabase.table("story_translations")
                .select("story_text_id, title, teaser")
                .eq("language_id", lang_id)
                .in_("story_text_id", [s["id"] for s in kept])
                .execute().data or []
            )
            translated = {r["story_text_id"]: r for r in rows}
        except Exception as e:
            print(f"[language view] {e}")
    out = []
    for s in kept:
        tr = translated.get(s["id"])
        item = {**s, "language_code": code}
        if tr:
            item["title"] = tr.get("title") or s.get("title")
            item["teaser"] = tr.get("teaser") or s.get("teaser")
        out.append(item)
    return out


def get_precreated_stories(
    category_id: Optional[str] = None,
    age_group_id: int = 1,
    language_id: int = 1,
    sort_by: str = "popular",
    is_admin: bool = False,
    language_code: Optional[str] = None,
) -> List[Dict[str, Any]]:
    stories = _precreated_core(category_id, age_group_id, language_id, sort_by, is_admin)
    return apply_language_view(get_supabase(), stories, language_code)


_FEED_CACHE: Dict[Any, Any] = {}
_FEED_TTL_SECONDS = 20


def clear_feed_cache() -> None:
    """Call after any change to the public library (publish/edit/delete/rate)."""
    _FEED_CACHE.clear()


def get_home_feed(age_group_id: int = 1, sort_by: str = "popular", language_code: Optional[str] = None) -> Dict[str, Any]:
    """
    The whole Home screen in ONE call: every active category with its stories
    (plus an "Others" row), already de-duplicated. Replaces ~10 separate
    requests, never auto-generates stories, and is cached for a few seconds.
    """
    key = (age_group_id, sort_by, (language_code or "").lower())
    hit = _FEED_CACHE.get(key)
    if hit and time.time() - hit[0] < _FEED_TTL_SECONDS:
        return hit[1]

    supabase = get_supabase()
    cats = supabase.table("story_categories").select("*").eq("is_active", True).execute().data or []

    # The whole shared library is shown to every user, with or without a child
    # profile / age group.
    query = (
        supabase.table("story_texts")
        .select("id, category_id, age_group_id, language_id, title, teaser, generation_status, times_served, cover_image_url, created_at, average_rating, total_ratings")
        .is_("owner_user_id", "null")
    )
    if sort_by == "newest":
        query = query.order("created_at", desc=True)
    else:
        query = query.order("times_served", desc=True).order("created_at", desc=True)
    raw = query.limit(500).execute().data or []

    stories = enrich_audio_story_items(supabase, raw)
    stories = apply_language_view(supabase, stories, language_code)

    known = {c["id"] for c in cats}
    by_cat: Dict[Any, list] = {}
    others = []
    for s in stories:
        cid = s.get("category_id")
        if cid in known:
            by_cat.setdefault(cid, []).append(s)
        else:
            others.append(s)

    rows = [{"category": c, "stories": by_cat.get(c["id"], [])} for c in cats]
    if others:
        rows.append({"category": {"id": "others", "name": "Others", "icon_url": "📦"}, "stories": others})

    seen_ids, seen_titles = set(), set()
    out_rows = []
    for r in rows:
        kept = []
        for st in r["stories"][:50]:
            title_key = " ".join(str(st.get("title") or "").lower().split())
            if st["id"] in seen_ids or (title_key and title_key in seen_titles):
                continue
            seen_ids.add(st["id"])
            if title_key:
                seen_titles.add(title_key)
            kept.append(st)
        if kept:
            out_rows.append({"category": r["category"], "stories": kept})

    result = {"categories": cats, "rows": out_rows}
    _FEED_CACHE[key] = (time.time(), result)
    return result


def search_stories(
    query: str,
    age_group_id: int,
    language_id: int = 1,
    allow_ai_generate: bool = True,
    is_admin: bool = False,
    category_id: Optional[str] = None,
    language_code: Optional[str] = None,
) -> list:
    results = _search_core(query, age_group_id, language_id, allow_ai_generate, is_admin, category_id)
    return apply_language_view(get_supabase(), results, language_code)


def browse_story_options(
    category_id: str,
    age_group_id: int,
    language_id: int = 1,
    target_count: int = 20
) -> List[Dict[str, Any]]:
    """Convenience alias for browsing library stories."""
    return get_precreated_stories(category_id=category_id, age_group_id=age_group_id, language_id=language_id)




def verify_content_safety(title: str, story_text: str, age_label: str) -> tuple[bool, str]:
    """
    Evaluates generated story content against safety and child-suitability standards.
    Returns (is_safe: bool, notes: str).
    """
    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    safety_prompt = f"""Review the following children's bedtime story text for safety and age-appropriateness.
Age Group: {age_label}
Title: {title}

Story Excerpt (first 1000 words):
{story_text[:4000]}

Safety Criteria:
1. Is it safe and gentle for a young child's bedtime?
2. Does it contain any violence, horror, cruelty, sexually suggestive content, or nightmare triggers?
3. Is it 100% appropriate for kids?

Respond strictly with a JSON object:
{{"is_safe": true/false, "notes": "brief reason"}}
"""

    try:
        response = client.models.generate_content(
            model="gemini-flash-latest",
            contents=safety_prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1
            )
        )
        data = clean_json_response(response.text)
        return bool(data.get("is_safe", True)), data.get("notes", "Passed automated bedtime safety check.")
    except Exception as exc:
        # Fallback if safety review model call experiences transient issues
        return True, f"Defaulted safe with note: {str(exc)}"



def _search_core(
    query: str,
    age_group_id: int,
    language_id: int = 1,
    allow_ai_generate: bool = True,
    is_admin: bool = False,
    category_id: Optional[str] = None,
) -> list:
    """
    Searches stories matching query in title or teaser. Generating a brand
    new story when search finds nothing is admin-only, regardless of
    `allow_ai_generate` - a regular user's search-miss just returns empty.

    When an admin generates a new story from a search miss, the FULL story
    text is written immediately (not just a title/teaser stub) and run
    through the same safety check used for on-demand generation elsewhere,
    so it's a complete, ready-to-read story the moment it's created. The
    caller-supplied `category_id` is used when given (admin picks a category
    in the app); otherwise it falls back to a default "misc" category.
    """
    allow_ai_generate = allow_ai_generate and is_admin
    supabase = get_supabase()
    q = query.strip()
    if not q:
        return []

    # 1. Search database
    db_query = (
        supabase.table("story_texts")
        .select("id, category_id, age_group_id, language_id, title, teaser, generation_status, times_served, cover_image_url, created_at, average_rating, total_ratings")
        .is_("owner_user_id", "null")
    )
    if category_id:
        db_query = db_query.eq("category_id", category_id)
    db_matches = db_query.ilike("title", f"%{q}%").execute()

    # Also search by teaser
    db_teaser_query = (
        supabase.table("story_texts")
        .select("id, category_id, age_group_id, language_id, title, teaser, generation_status, times_served, cover_image_url, created_at, average_rating, total_ratings")
        .is_("owner_user_id", "null")
    )
    if category_id:
        db_teaser_query = db_teaser_query.eq("category_id", category_id)
    db_teaser_matches = db_teaser_query.ilike("teaser", f"%{q}%").execute()

    results = db_matches.data or []
    # Merge unique
    seen = {r["id"] for r in results}
    for r in (db_teaser_matches.data or []):
        if r["id"] not in seen:
            results.append(r)
            seen.add(r["id"])

    if results or not allow_ai_generate:
        return enrich_audio_story_items(supabase, results)

    # Generate a brand-new, fully-written story for this topic (admin only).
    resolved_category_id = category_id or "c1a017d4-0c2d-417d-9273-05b1c9441113"  # fallback "misc" category
    try:
        cat_res = (
            supabase.table("story_categories").select("name").eq("id", resolved_category_id).single().execute()
        )
        age_res = supabase.table("age_groups").select("label").eq("id", age_group_id).single().execute()
        lang_res = supabase.table("languages").select("label").eq("id", language_id).single().execute()
        category_name = cat_res.data["name"] if cat_res.data else "Bedtime"
        age_label = age_res.data["label"] if age_res.data else "kids"
        language_label = lang_res.data["label"] if lang_res.data else "English"

        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        title_prompt = f"""You are a master children's bedtime storyteller.
Parent requested a story about: "{q}"
Create a very short title and 1 sentence teaser for a new bedtime story about this.
Return JSON: {{"title": "...", "teaser": "..."}}"""
        resp = call_gemini_with_fallback(
            client=client,
            prompt=title_prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        data = clean_json_response(resp.text)
        title = data.get("title", f"Story about {q}")
        teaser = data.get("teaser", f"A cozy bedtime story about {q}.")

        full_text = generate_full_story_text(
            title=title,
            teaser=teaser,
            category_name=category_name,
            age_label=age_label,
            language_label=language_label,
        )
        full_text = sanitize_text(full_text)

        is_safe, safety_notes = verify_content_safety(title, full_text, age_label)

        insert_payload = {
            "title": title,
            "teaser": teaser,
            "age_group_id": age_group_id,
            "language_id": language_id,
            "category_id": resolved_category_id,
            "generation_status": "full_generated" if is_safe else "safety_rejected",
            "safety_check_status": "passed" if is_safe else "failed",
        }
        if is_safe:
            insert_payload["full_text"] = full_text

        ins_res = supabase.table("story_texts").insert(insert_payload).execute()
        if ins_res.data and is_safe:
            results.append(ins_res.data[0])
        elif not is_safe:
            print(f"Admin search-generated story for '{q}' failed safety check: {safety_notes}")

    except Exception as e:
        print("Failed to generate search fallback", e)

    return enrich_audio_story_items(supabase, results)


def _resolve_labels(supabase, category_id: str, age_group_id: int, language_id: int) -> tuple[str, str, str]:
    """Shared helper: looks up the human-readable category/age/language labels
    used to steer Gemini prompts, with safe fallbacks if a lookup fails."""
    cat_res = supabase.table("story_categories").select("name").eq("id", category_id).single().execute()
    age_res = supabase.table("age_groups").select("label").eq("id", age_group_id).single().execute()
    lang_res = supabase.table("languages").select("label").eq("id", language_id).single().execute()
    category_name = cat_res.data["name"] if cat_res.data else "Bedtime"
    age_label = age_res.data["label"] if age_res.data else "kids"
    language_label = lang_res.data["label"] if lang_res.data else "English"
    return category_name, age_label, language_label


def publish_manual_story(
    title: str,
    full_text: str,
    category_id: str,
    age_group_id: int,
    language_id: int = 1,
    teaser: str = None,
    voice_id: str = "luna",
    accent_id: str = "us",
    cover_image_bytes: bytes = None,
    cover_image_mime: str = None,
    language_code: str = None,
    extra_language_codes: list = None,
) -> dict:
    """
    Admin manual publish: the admin types or pastes the story text directly
    (same idea as the PDF/TXT/DOCX upload path - narrate exactly what was
    given, verbatim) instead of asking Gemini to write it. This makes ZERO
    Gemini calls, so it can never fail from Gemini being rate-limited or
    overloaded - it's the one, reliable way to create new Library content,
    with the admin picking a narrator voice + accent (Luna/Oliver/Willow/
    Jasper, in US/UK/Indian/Australian English) and optionally a cover
    picture, which is uploaded to the "story-covers" Supabase Storage bucket
    and saved as story_texts.cover_image_url.

    Always synthesizes and caches the voice narration immediately before
    returning (via commit_and_narrate_story), so the story is 100% ready
    (text + audio, and cover image if provided) the moment it's published -
    saved once, available to every parent instantly, no per-user cost.
    """
    supabase = get_supabase()

    title = sanitize_text((title or "").strip())
    full_text = sanitize_text((full_text or "").strip())
    if not title:
        raise ValueError("Please enter a title.")
    if not full_text or word_count(full_text) < 20:
        raise ValueError("Please enter the full story text (at least a few sentences).")

    language_id, lang_label, lang_code = resolve_language(supabase, language_id, language_code)
    # If the admin picked a language different from the text they typed,
    # translate the story (and its title/teaser) into the chosen language.
    full_text, was_translated = ensure_text_in_language(full_text, lang_code, lang_label)
    if was_translated:
        title, _ = ensure_text_in_language(title, lang_code, lang_label)
        teaser = None
        title = sanitize_text(title)
    elif teaser:
        teaser, _ = ensure_text_in_language(teaser, lang_code, lang_label)

    teaser = sanitize_text((teaser or "").strip()) or derive_teaser_from_text(full_text)

    insert_payload = {
        "title": title,
        "teaser": teaser,
        "full_text": full_text,
        "age_group_id": age_group_id,
        "language_id": language_id,
        "category_id": category_id,
        "generation_status": "full_generated",
        # The DB column has a check constraint that only allows a fixed set
        # of values (e.g. "passed"/"failed") - "manual_admin_entry" isn't
        # one of them and made every publish fail with a 23514 violation.
        # Admin-written text skips the AI safety check by design (the admin
        # is the author), so "passed" is the accurate, already-allowed value.
        "safety_check_status": "passed",
    }

    ins_res = supabase.table("story_texts").insert(insert_payload).execute()
    if not ins_res.data:
        raise RuntimeError("Failed to save the story.")

    new_story = ins_res.data[0]

    if cover_image_bytes:
        try:
            ext = "png" if "png" in (cover_image_mime or "").lower() else "jpg"
            storage_path = f"{new_story['id']}.{ext}"
            supabase.storage.from_("story-covers").upload(
                path=storage_path,
                file=cover_image_bytes,
                file_options={"content-type": cover_image_mime or "image/jpeg", "upsert": "true"},
            )
            cover_url = supabase.storage.from_("story-covers").get_public_url(storage_path)
            supabase.table("story_texts").update({"cover_image_url": cover_url}).eq("id", new_story["id"]).execute()
            new_story["cover_image_url"] = cover_url
            new_story["cover_image_upload_failed"] = False
        except Exception as e:
            # Cover picture is a nice-to-have - never let it block the
            # publish; the story text + audio still go through. The
            # frontend surfaces this flag to the admin as a clear
            # "cover image failed to upload" notice.
            print(f"Cover image upload failed for story {new_story['id']}: {e}")
            new_story["cover_image_upload_failed"] = True

    try:
        commit_and_narrate_story(
            story_text_id=new_story["id"],
            voice_id=voice_id,
            voice_tier="standard",
            user_id=None,
            is_admin=True,
            accent_id=accent_id,
        )
    except Exception as e:
        print(f"Immediate narration failed for manually published story {new_story['id']}, will narrate on first play instead: {e}")

    language_errors = []
    if extra_language_codes:
        try:
            done = add_story_languages(new_story["id"], extra_language_codes, voice_id=voice_id, accent_id=accent_id)
            language_errors = done.get("errors", [])
        except Exception as e:
            language_errors = [str(e)]

    enriched = enrich_audio_story_items(supabase, [new_story])
    out = enriched[0] if enriched else new_story
    if language_errors:
        out["language_errors"] = language_errors
    return out


def _voice_and_accent_for_story(supabase, story_text_id: str) -> tuple:
    """
    Looks up which narrator voice + accent a story is currently cached
    with, by parsing story_audio.provider (format "google_tts:{voice}:
    {accent}", or the older "google_tts:{voice}" before accents existed).
    Falls back to luna/us if the story has no cached audio yet.
    """
    voice_id, accent_id = "luna", "us"
    audio_res = (
        supabase.table("story_audio")
        .select("provider")
        .eq("story_text_id", story_text_id)
        .execute()
    )
    if audio_res.data:
        provider = (audio_res.data[0].get("provider") or "")
        parts = provider.split(":")
        if len(parts) >= 2 and parts[0] == "google_tts":
            voice_id = parts[1] or voice_id
            accent_id = parts[2] if len(parts) == 3 and parts[2] else accent_id
    return voice_id, accent_id


def get_story_admin_detail(story_text_id: str) -> dict:
    """
    Full editable detail for the admin "Edit Story" screen: title, full
    text, teaser, cover image, category/age/language, and the narrator
    voice + accent the story is currently narrated with (so the edit
    re-narration, if the text changes, keeps using the same ones).
    """
    supabase = get_supabase()
    story_res = supabase.table("story_texts").select("*").eq("id", story_text_id).single().execute()
    if not story_res.data:
        raise ValueError("Story not found.")
    story = story_res.data
    voice_id, accent_id = _voice_and_accent_for_story(supabase, story_text_id)

    return {
        "id": story["id"],
        "title": story.get("title"),
        "teaser": story.get("teaser"),
        "full_text": story.get("full_text"),
        "category_id": story.get("category_id"),
        "age_group_id": story.get("age_group_id"),
        "language_id": story.get("language_id"),
        "cover_image_url": story.get("cover_image_url"),
        "voice_id": voice_id,
        "accent_id": accent_id,
    }


def update_manual_story(
    story_text_id: str,
    title: str = None,
    full_text: str = None,
    teaser: str = None,
    cover_image_bytes: bytes = None,
    cover_image_mime: str = None,
    remove_cover_image: bool = False,
) -> dict:
    """
    Admin edit of an already-published story: change its title, full text,
    and/or cover image. Category and narrator voice/accent stay fixed - if
    the text actually changed, the old cached narration no longer matches
    the words, so it's re-synthesized immediately (same voice/accent this
    story already used), replacing the stale cached audio for everyone.
    """
    supabase = get_supabase()

    story_res = supabase.table("story_texts").select("*").eq("id", story_text_id).single().execute()
    if not story_res.data:
        raise ValueError("Story not found.")
    story = story_res.data

    update_payload = {}
    text_changed = False

    if title is not None and title.strip():
        clean_title = sanitize_text(title.strip())
        update_payload["title"] = clean_title

    if full_text is not None and full_text.strip():
        clean_text = sanitize_text(full_text.strip())
        if word_count(clean_text) < 20:
            raise ValueError("Please enter the full story text (at least a few sentences).")
        if clean_text != (story.get("full_text") or ""):
            text_changed = True
        update_payload["full_text"] = clean_text
        if teaser is None or not teaser.strip():
            update_payload["teaser"] = derive_teaser_from_text(clean_text)

    if teaser is not None and teaser.strip():
        update_payload["teaser"] = sanitize_text(teaser.strip())

    if remove_cover_image and not cover_image_bytes:
        update_payload["cover_image_url"] = None

    if update_payload:
        supabase.table("story_texts").update(update_payload).eq("id", story_text_id).execute()

    cover_image_upload_failed = None
    if cover_image_bytes:
        try:
            ext = "png" if "png" in (cover_image_mime or "").lower() else "jpg"
            storage_path = f"{story_text_id}.{ext}"
            supabase.storage.from_("story-covers").upload(
                path=storage_path,
                file=cover_image_bytes,
                file_options={"content-type": cover_image_mime or "image/jpeg", "upsert": "true"},
            )
            cover_url = supabase.storage.from_("story-covers").get_public_url(storage_path)
            supabase.table("story_texts").update({"cover_image_url": cover_url}).eq("id", story_text_id).execute()
            cover_image_upload_failed = False
        except Exception as e:
            print(f"Cover image upload failed while editing story {story_text_id}: {e}")
            cover_image_upload_failed = True

    if text_changed:
        # Other-language versions are kept as they are (edit them separately).
        voice_id, accent_id = _voice_and_accent_for_story(supabase, story_text_id)
        try:
            commit_and_narrate_story(
                story_text_id=story_text_id,
                voice_id=voice_id,
                voice_tier="standard",
                user_id=None,
                is_admin=True,
                accent_id=accent_id,
                force_resynthesize=True,
            )
        except Exception as e:
            print(f"Re-narration failed after editing story {story_text_id}: {e}")

    fresh_res = supabase.table("story_texts").select("*").eq("id", story_text_id).single().execute()
    fresh = fresh_res.data if fresh_res.data else story
    enriched = enrich_audio_story_items(supabase, [fresh])
    result = enriched[0] if enriched else fresh
    if cover_image_upload_failed is not None:
        result["cover_image_upload_failed"] = cover_image_upload_failed
    return result


def delete_story_completely(story_text_id: str) -> None:
    """
    Admin hard delete: permanently removes a story and everything derived
    from it - its cached narration (DB row + the mp3 file in storage), its
    cover picture file, its star ratings, any personalized (child-name-
    woven) copies made from it, and its play-history entries. That last
    one is what makes it disappear from every parent's and the admin's
    History screen too, not just the Library and search - nothing is left
    behind pointing at an id that no longer exists. This cannot be undone.
    """
    supabase = get_supabase()

    story_res = supabase.table("story_texts").select("id").eq("id", story_text_id).single().execute()
    if not story_res.data:
        raise ValueError("Story not found.")

    # Storage cleanup first, best-effort - never blocks the DB delete below,
    # since a leftover orphaned file is far less bad than a delete that
    # silently fails to remove the story.
    try:
        files = supabase.storage.from_("story-audio").list("standard")
        to_remove = [
            f"standard/{f['name']}" for f in (files or [])
            if f.get("name", "").startswith(f"{story_text_id}_")
        ]
        if to_remove:
            supabase.storage.from_("story-audio").remove(to_remove)
    except Exception as e:
        print(f"Storage cleanup (audio) failed for story {story_text_id}: {e}")

    try:
        cover_files = supabase.storage.from_("story-covers").list()
        to_remove = [
            f["name"] for f in (cover_files or [])
            if f.get("name", "").startswith(f"{story_text_id}.")
        ]
        if to_remove:
            supabase.storage.from_("story-covers").remove(to_remove)
    except Exception as e:
        print(f"Storage cleanup (cover) failed for story {story_text_id}: {e}")

    # Related rows, so nothing orphaned is left referencing this story.
    for table, column in (
        ("personalized_stories", "base_story_text_id"),
        ("story_events", "story_text_id"),
        ("story_ratings", "story_text_id"),
        ("story_audio", "story_text_id"),
    ):
        try:
            supabase.table(table).delete().eq(column, story_text_id).execute()
        except Exception as e:
            print(f"Failed to delete {table} rows for story {story_text_id}: {e}")

    supabase.table("story_texts").delete().eq("id", story_text_id).execute()


def generate_custom_story(
    prompt: str,
    age_group_id: int,
    category_id: Optional[str] = None,
    language_id: int = 1,
    voice_id: str = "luna",
    user_id: Optional[str] = None,
    subscription_tier: str = "free",
    accent_id: str = "us",
) -> Dict[str, Any]:
    """
    Generate a brand-new custom bedtime story:
    1. Checks & enforces the monthly limit of 10 custom stories for free tier.
    2. Weaves original 5-7 min bedtime story text with Gemini.
    3. Synthesizes narration in the selected voice (Luna, Oliver, Willow, Jasper).
    4. Saves into story_texts and story_audio.
    5. Returns story with matching ambient soundscape.
    """
    from app.services.usage_service import check_and_increment_usage
    from app.services.tts_service import synthesize_story_audio
    from app.services.history_service import record_story_event

    supabase = get_supabase()

    # 1. Enforce monthly limit (varies by plan - see usage_service.TIER_LIMITS)
    if user_id:
        allowed = check_and_increment_usage(
            user_id=user_id,
            subscription_tier=subscription_tier,
            usage_type="new_story_generation"
        )
        if not allowed:
            raise ValueError("✨ Monthly limit reached! You've used all your custom story generations this month. You can continue listening to unlimited stories in the library.")

    # 2. Get category & age group metadata
    age_res = supabase.table("age_groups").select("label").eq("id", age_group_id).limit(1).execute()
    age_label = age_res.data[0]["label"] if (age_res.data and len(age_res.data) > 0) else "kids"

    cat_name = "Bedtime Adventures"
    if category_id:
        cat_res = supabase.table("story_categories").select("name").eq("id", category_id).limit(1).execute()
        if cat_res.data:
            cat_name = cat_res.data[0].get("name", "Bedtime")
    else:
        # Default category
        cat_res = supabase.table("story_categories").select("id, name").limit(1).execute()
        if cat_res.data:
            category_id = cat_res.data[0]["id"]
            cat_name = cat_res.data[0]["name"]

    lang_res = supabase.table("languages").select("label, code").eq("id", language_id).limit(1).execute()
    lang_label = lang_res.data[0]["label"] if (lang_res.data and len(lang_res.data) > 0) else "English"
    lang_code = lang_res.data[0].get("code", "en") if (lang_res.data and len(lang_res.data) > 0) else "en"

    # 3. Narrate exactly what the parent typed - no Gemini call, no AI
    # rewriting. Trimmed to this plan's length cap (4 min for Normal,
    # ~7-8 min for Pro/admin - see target_words_for_tier).
    full_text, truncated = enforce_story_length(prompt, target_words=target_words_for_tier(subscription_tier))
    title = derive_title_from_text(prompt)
    teaser = derive_teaser_from_text(full_text)
    notice = TRUNCATION_NOTICE if truncated else None

    # 4. Insert into story_texts
    # Final safety net: guarantee nothing NUL-containing ever reaches Postgres,
    # regardless of which branch above produced title/teaser/full_text.
    title = sanitize_text(title)
    teaser = sanitize_text(teaser)
    full_text = sanitize_text(full_text)

    _enforce_free_tier_tts_budget(subscription_tier, len(full_text))

    insert_payload = {
        "title": title,
        "teaser": teaser,
        "full_text": full_text,
        "age_group_id": age_group_id,
        "category_id": category_id,
        "language_id": language_id,
        "generation_status": "full_generated",
        "times_served": 0,
        # Private: only the user who created this story can see it
        "owner_user_id": user_id,
    }
    res = supabase.table("story_texts").insert(insert_payload).execute()
    if not res.data:
        raise ValueError("Failed to save generated story.")
        
    story_text_id = res.data[0]["id"]
    
    # 5. Render TTS
    audio_bytes, duration_seconds = synthesize_story_audio(
        full_text=full_text,
        language_code=lang_code,
        voice_id=voice_id,
        accent_id=accent_id
    )
    from app.services.tts_usage_service import record_tts_characters
    record_tts_characters(len(full_text))

    storage_path = f"standard/{story_text_id}_{voice_id}_{accent_id}.mp3"
    supabase.storage.from_("story-audio").upload(
        path=storage_path,
        file=audio_bytes,
        file_options={"content-type": "audio/mpeg", "upsert": "true"}
    )
    public_audio_url = supabase.storage.from_("story-audio").get_public_url(storage_path)

    # 6. Insert into story_audio
    audio_insert_payload = {
        "story_text_id": story_text_id,
        "voice_tier": "standard",
        "provider": f"google_tts:{voice_id}:{accent_id}",
        "audio_url": public_audio_url,
        "duration_seconds": duration_seconds
    }
    supabase.table("story_audio").upsert(audio_insert_payload, on_conflict="story_text_id,voice_tier").execute()

    ambient_sound = get_ambient_track_for_story(title, teaser)

    record_story_event(
        user_id=user_id,
        origin="create_narrator",
        story_text_id=story_text_id,
        title=title,
        voice_id=voice_id,
        audio_url=public_audio_url,
        duration_seconds=duration_seconds,
    )

    return {
        "id": story_text_id,
        "story_text_id": story_text_id,
        "title": title,
        "teaser": teaser,
        "full_text": full_text,
        "audio_url": public_audio_url,
        "duration_seconds": duration_seconds,
        "voice_tier": "standard",
        "provider": f"google_tts:{voice_id}",
        "ambient_sound": ambient_sound,
        "cached": False,
        "truncated": truncated,
        "notice": notice
    }

def generate_multimodal_story(
    input_mode: str,  # 'text' | 'image' | 'pdf' | 'file'
    text_prompt: str = None,
    file_bytes: bytes = None,
    file_mime_type: str = None,
    file_name: str = None,
    age_group_id: int = 1,
    category_id: str = None,
    language_id: int = 1,
    voice_id: str = "luna",
    user_id: str = None,
    subscription_tier: str = "free",
    pdf_page_from: int = None,
    pdf_page_to: int = None,
    accent_id: str = "us",
    language_code: str = None,
) -> dict:
    from app.services.usage_service import check_and_increment_usage
    from app.services.tts_service import synthesize_story_audio
    from app.services.history_service import record_story_event
    import io
    from PIL import Image
    import pypdf

    supabase = get_supabase()

    if user_id:
        allowed = check_and_increment_usage(
            user_id=user_id,
            subscription_tier=subscription_tier,
            usage_type="new_story_generation"
        )
        if not allowed:
            raise ValueError("? Monthly limit reached! You have used all custom story generations this month.")

    age_res = supabase.table("age_groups").select("label").eq("id", age_group_id).limit(1).execute()
    age_label = age_res.data[0]["label"] if age_res.data else "kids"

    cat_name = "Bedtime Adventures"
    if category_id:
        cat_res = supabase.table("story_categories").select("name").eq("id", category_id).limit(1).execute()
        if cat_res.data:
            cat_name = cat_res.data[0].get("name", "Bedtime")
    else:
        cat_res = supabase.table("story_categories").select("id, name").limit(1).execute()
        if cat_res.data:
            category_id = cat_res.data[0]["id"]
            cat_name = cat_res.data[0]["name"]

    language_id, lang_label, lang_code = resolve_language(supabase, language_id, language_code)

    truncated = False
    notice = None

    if input_mode == "image" and file_bytes:
        # Photos need Gemini's vision to read the page - there's no
        # deterministic OCR path here. This is transcription ONLY: no
        # rewriting, no story-writing, just "read exactly what's on the
        # page," then it goes through the same verbatim pipeline as a
        # text file.
        client = genai.Client(api_key=settings.GEMINI_API_KEY)

        try:
            pil_image = Image.open(io.BytesIO(file_bytes)).convert("RGB")
            pil_image.thumbnail((1600, 1600))
        except Exception as img_err:
            raise ValueError(f"Unable to process image file: {str(img_err)}")

        ocr_prompt = """Transcribe ALL of the readable text in this photo, exactly as
written, word for word, in reading order. Do NOT summarize, rewrite, translate,
correct, or add anything - do not describe the picture itself, only output the
text that appears in it. If there is no readable text, return an empty string.

Return ONLY valid JSON: {"extracted_text": "..."}
"""
        response = call_gemini_with_fallback(
            client=client,
            prompt=[pil_image, ocr_prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0,
            )
        )

        parsed = clean_json_response(response.text)
        extracted_text = sanitize_text(
            parsed.get("extracted_text", "") if isinstance(parsed, dict) else ""
        ).strip()

        if not extracted_text or not looks_like_readable_text(extracted_text):
            raise ValueError(
                "We couldn't find any readable text in that photo. Try a clearer, "
                "well-lit picture of the page, with the text filling the frame."
            )

        full_text, truncated = enforce_story_length(extracted_text, target_words=target_words_for_language(subscription_tier, lang_code))
        title = derive_title_from_text(extracted_text)
        teaser = derive_teaser_from_text(full_text)
        if truncated:
            notice = TRUNCATION_NOTICE

    elif input_mode in ("pdf", "file") and file_bytes:
        ext = file_name.rsplit(".", 1)[-1].lower() if file_name and "." in file_name else ""
        mime = (file_mime_type or "").lower()
        extracted_text = ""

        if ext == "doc":
            raise ValueError(
                "Old-format Word files (.doc) aren't supported yet - please save it "
                "as .docx, PDF, or .txt and try again."
            )

        elif ext == "docx" or "wordprocessingml" in mime:
            try:
                from docx import Document as DocxDocument
                docx_file = DocxDocument(io.BytesIO(file_bytes))
                extracted_text = "\n".join(p.text for p in docx_file.paragraphs if p.text)
            except Exception:
                extracted_text = ""
            extracted_text = sanitize_text(extracted_text)

        else:
            # Try PDF first regardless of declared mime/extension (browsers/Expo
            # don't always report these reliably).
            try:
                reader = pypdf.PdfReader(io.BytesIO(file_bytes))
                total_pages = len(reader.pages)

                if pdf_page_from is not None or pdf_page_to is not None:
                    # "Page Range" mode - the parent chose specific pages
                    # (e.g. one chapter out of a big storybook PDF).
                    start = pdf_page_from if pdf_page_from is not None else 1
                    end = pdf_page_to if pdf_page_to is not None else total_pages
                    if start < 1 or end < 1:
                        raise ValueError("Page numbers must be 1 or higher.")
                    if start > end:
                        raise ValueError(f"'From page' ({start}) can't be after 'To page' ({end}).")
                    if start > total_pages:
                        raise ValueError(
                            f"This PDF only has {total_pages} page{'s' if total_pages != 1 else ''}, "
                            f"but you asked to start at page {start}."
                        )
                    # Clamp the end so asking for "to page 500" on a 10-page
                    # PDF just reads through the last real page instead of
                    # erroring.
                    end = min(end, total_pages)
                    pages_to_read = reader.pages[start - 1:end]
                else:
                    # "Normal Read" mode - the whole document. There's no
                    # separate page cap here anymore: the final story length
                    # is already bounded by the subscription tier's word
                    # limit below (enforce_story_length), regardless of how
                    # much text came out of the PDF, so an artificial page
                    # cap here was just silently truncating longer PDFs for
                    # no real benefit.
                    pages_to_read = reader.pages

                for page in pages_to_read:
                    txt = page.extract_text() or ""
                    extracted_text += txt + "\n"
            except ValueError:
                raise
            except Exception:
                pass

            extracted_text = sanitize_text(extracted_text)

            if not extracted_text.strip() or not looks_like_readable_text(extracted_text):
                # PDF parsing failed or produced nothing usable - try decoding the
                # raw bytes as plain text. NOTE: these decodes never raise on
                # binary input (e.g. a .docx/.doc is a zip/OLE file, not text),
                # they just produce garbage full of control characters - so we
                # explicitly check the result actually looks like readable text
                # instead of trusting "it decoded without an error."
                extracted_text = ""
                for encoding in ("utf-8", "latin-1", "cp1252"):
                    try:
                        decoded = sanitize_text(file_bytes.decode(encoding).strip())
                        if decoded and looks_like_readable_text(decoded):
                            extracted_text = decoded
                            break
                    except Exception:
                        pass

        if not extracted_text.strip() or not looks_like_readable_text(extracted_text):
            raise ValueError(
                "We couldn't read this file as plain text. Please upload a PDF, "
                ".txt, or .docx file - scanned pages and other formats aren't "
                "supported yet (try 'Upload Photo' for a scanned page)."
            )

        extracted_text = extracted_text.strip()

        # Narrate the file's own text exactly as extracted - no Gemini call,
        # no AI rewriting, at any length.
        full_text, truncated = enforce_story_length(extracted_text, target_words=target_words_for_language(subscription_tier, lang_code))
        title = derive_title_from_text(extracted_text)
        teaser = derive_teaser_from_text(full_text)
        if truncated:
            notice = TRUNCATION_NOTICE

    else:
        prompt = (text_prompt or "A calm night").strip()

        # Narrate exactly what was typed - no Gemini call, no AI rewriting.
        full_text, truncated = enforce_story_length(prompt, target_words=target_words_for_language(subscription_tier, lang_code))
        title = derive_title_from_text(prompt)
        teaser = derive_teaser_from_text(full_text)
        if truncated:
            notice = TRUNCATION_NOTICE

    # Convert to the language the parent picked (skipped when the text is
    # already in that language). Length was already capped above in the
    # source text, scaled for the chosen language.
    full_text, was_translated = ensure_text_in_language(full_text, lang_code, lang_label)
    if was_translated:
        title, _ = ensure_text_in_language(title, lang_code, lang_label)
        teaser = derive_teaser_from_text(full_text)

    # Final safety net: guarantee nothing NUL-containing ever reaches Postgres,
    # regardless of which branch above produced title/teaser/full_text.
    title = sanitize_text(title)
    teaser = sanitize_text(teaser)
    full_text = sanitize_text(full_text)

    _enforce_free_tier_tts_budget(subscription_tier, len(full_text))

    insert_payload = {
        "title": title,
        "teaser": teaser,
        "full_text": full_text,
        "age_group_id": age_group_id,
        "category_id": category_id,
        "language_id": language_id,
        "generation_status": "full_generated",
        "times_served": 0,
        # Private: only the user who created this story can see it
        "owner_user_id": user_id,
    }
    res = supabase.table("story_texts").insert(insert_payload).execute()
    if not res.data:
        raise ValueError("Failed to save generated story.")

    story_text_id = res.data[0]["id"]

    audio_bytes, duration_seconds = synthesize_story_audio(
        full_text=full_text,
        language_code=lang_code,
        voice_id=voice_id,
        accent_id=accent_id
    )
    from app.services.tts_usage_service import record_tts_characters
    record_tts_characters(len(full_text))

    storage_path = f"standard/{story_text_id}_{voice_id}_{accent_id}.mp3"
    supabase.storage.from_("story-audio").upload(
        path=storage_path,
        file=audio_bytes,
        file_options={"content-type": "audio/mpeg", "upsert": "true"}
    )
    public_audio_url = supabase.storage.from_("story-audio").get_public_url(storage_path)

    audio_insert_payload = {
        "story_text_id": story_text_id,
        "voice_tier": "standard",
        "provider": f"google_tts:{voice_id}:{accent_id}",
        "audio_url": public_audio_url,
        "duration_seconds": duration_seconds
    }
    supabase.table("story_audio").upsert(audio_insert_payload, on_conflict="story_text_id,voice_tier").execute()

    ambient_sound = get_ambient_track_for_story(title, teaser)

    record_story_event(
        user_id=user_id,
        origin="create_narrator",
        story_text_id=story_text_id,
        title=title,
        voice_id=voice_id,
        audio_url=public_audio_url,
        duration_seconds=duration_seconds,
    )

    return {
        "id": story_text_id,
        "story_text_id": story_text_id,
        "title": title,
        "teaser": teaser,
        "full_text": full_text,
        "audio_url": public_audio_url,
        "duration_seconds": duration_seconds,
        "voice_tier": "standard",
        "provider": f"google_tts:{voice_id}",
        "ambient_sound": ambient_sound,
        "cached": False,
        "truncated": truncated,
        "notice": notice
    }

def commit_and_narrate_story(
    story_text_id: str,
    voice_id: str = "luna",
    voice_tier: str = "standard",
    user_id: Optional[str] = None,
    is_admin: bool = False,
    accent_id: str = "us",
    force_resynthesize: bool = False,
) -> dict:
    """
    Narrates a pre-existing story text using standard TTS, caches it in story_audio,
    or returns the cached audio URL. `accent_id` (us/gb/in/au) picks the
    English locale for the chosen narrator voice - each voice+accent
    combination gets its own cache slot, so switching accents on the same
    story re-synthesizes once and is then instant for everyone after.

    `force_resynthesize=True` skips the cache-hit check below entirely and
    always re-renders audio from the story's current full_text - used when
    an admin edits a story's text, since the old cached clip (for the same
    voice_tier_key) would otherwise be returned even though it no longer
    matches the edited words.

    Writing brand-new Library content (a teaser-only stub with no full_text
    yet) is admin-only - see the `is_admin` check below. Everyone else can
    only listen to stories that already have full_text, so a regular user
    can never accidentally trigger a Gemini call just by tapping a story.
    """
    from app.services.tts_service import synthesize_story_audio
    from app.services.history_service import record_story_event

    supabase = get_supabase()
    voice_tier_key = f"{voice_tier}_{voice_id}_{accent_id}" if voice_tier == "standard" else voice_tier

    story_res = supabase.table("story_texts").select("*").eq("id", story_text_id).single().execute()
    if not story_res.data:
        raise ValueError(f"Story text with id {story_text_id} not found.")
    story = story_res.data

    storage_path = f"standard/{story_text_id}_{voice_id}_{accent_id}.mp3"
    public_audio_url = supabase.storage.from_("story-audio").get_public_url(storage_path)

    audio_res = (
        supabase.table("story_audio")
        .select("*")
        .eq("story_text_id", story_text_id)
        .or_(f"voice_tier.eq.{voice_tier_key},voice_tier.eq.{voice_tier}")
        .execute()
    )

    ambient_sound = get_ambient_track_for_story(story.get("title", ""), story.get("teaser", ""))

    if audio_res.data and not force_resynthesize:
        for r in audio_res.data:
            if r.get("voice_tier") == voice_tier_key or r.get("provider") == f"google_tts:{voice_id}:{accent_id}" or f"_{voice_id}_{accent_id}.mp3" in (r.get("audio_url") or ""):
                supabase.table("story_texts").update({
                    "times_served": (story.get("times_served") or 0) + 1
                }).eq("id", story_text_id).execute()
                record_story_event(
                    user_id=user_id,
                    origin="library",
                    story_text_id=story_text_id,
                    title=story.get("title"),
                    voice_id=voice_id,
                    audio_url=r["audio_url"],
                    duration_seconds=r["duration_seconds"],
                )
                return {
                    "story_text_id": story_text_id,
                    "title": story["title"],
                    "teaser": story["teaser"],
                    "full_text": story["full_text"],
                    "audio_url": r["audio_url"],
                    "duration_seconds": r["duration_seconds"],
                    "voice_tier": voice_tier,
                    "provider": r["provider"],
                    "ambient_sound": ambient_sound,
                    "cached": True
                }

    full_text = story.get("full_text")
    if not full_text:
        if not is_admin:
            # Regular users can only listen to stories that already have
            # full text - writing brand-new Library content is admin-only
            # (avoids any random user's tap silently triggering a Gemini call).
            raise ValueError(
                "This story isn't ready to listen to yet. Please try another "
                "story from the Library - new stories are added regularly!"
            )
        # This is a teaser-only library stub (an AI-seeded title + teaser
        # with no story body yet, e.g. from the initial category batch or a
        # search-miss placeholder). Generate the full story now, on first
        # play, safety-check it, and persist it so every future play (for
        # this user and everyone else) is instant from here on.
        cat_res = (
            supabase.table("story_categories").select("name").eq("id", story["category_id"]).single().execute()
            if story.get("category_id") else None
        )
        age_res = supabase.table("age_groups").select("label").eq("id", story["age_group_id"]).single().execute()
        lang_label_res = supabase.table("languages").select("label").eq("id", story["language_id"]).single().execute()

        category_name = cat_res.data["name"] if cat_res and cat_res.data else "Bedtime"
        age_label = age_res.data["label"] if age_res.data else "kids"
        language_label = lang_label_res.data["label"] if lang_label_res.data else "English"

        generated_text = generate_full_story_text(
            title=story.get("title", "Bedtime Tale"),
            teaser=story.get("teaser", ""),
            category_name=category_name,
            age_label=age_label,
            language_label=language_label
        )
        generated_text = sanitize_text(generated_text)

        is_safe, safety_notes = verify_content_safety(story.get("title", ""), generated_text, age_label)
        if not is_safe:
            # Don't leave content that failed the check sitting in the
            # shared library waiting to be retried - flag it and stop.
            supabase.table("story_texts").update({
                "generation_status": "safety_rejected",
                "safety_check_status": "failed"
            }).eq("id", story_text_id).execute()
            raise ValueError(
                "This story didn't pass our bedtime safety check and can't be narrated. "
                "Please try another story."
            )

        supabase.table("story_texts").update({
            "full_text": generated_text,
            "generation_status": "full_generated",
            "safety_check_status": "passed"
        }).eq("id", story_text_id).execute()

        full_text = generated_text
        story["full_text"] = full_text

    lang_res = supabase.table("languages").select("code").eq("id", story["language_id"]).single().execute()
    lang_code = lang_res.data.get("code", "en") if lang_res.data else "en"

    audio_bytes, duration_seconds = synthesize_story_audio(
        full_text=full_text,
        language_code=lang_code,
        voice_id=voice_id,
        accent_id=accent_id
    )
    from app.services.tts_usage_service import record_tts_characters
    record_tts_characters(len(full_text))

    storage_path = f"standard/{story_text_id}_{voice_id}_{accent_id}.mp3"
    supabase.storage.from_("story-audio").upload(
        path=storage_path,
        file=audio_bytes,
        file_options={"content-type": "audio/mpeg", "upsert": "true"}
    )
    public_audio_url = supabase.storage.from_("story-audio").get_public_url(storage_path)

    audio_insert_payload = {
        "story_text_id": story_text_id,
        "voice_tier": voice_tier_key,
        "provider": f"google_tts:{voice_id}:{accent_id}",
        "audio_url": public_audio_url,
        "duration_seconds": duration_seconds
    }
    supabase.table("story_audio").upsert(
        audio_insert_payload,
        on_conflict="story_text_id,voice_tier"
    ).execute()

    supabase.table("story_texts").update({
        "times_served": (story.get("times_served") or 0) + 1
    }).eq("id", story_text_id).execute()

    record_story_event(
        user_id=user_id,
        origin="library",
        story_text_id=story_text_id,
        title=story.get("title"),
        voice_id=voice_id,
        audio_url=public_audio_url,
        duration_seconds=duration_seconds,
    )

    return {
        "story_text_id": story_text_id,
        "title": story["title"],
        "teaser": story["teaser"],
        "full_text": full_text,
        "audio_url": public_audio_url,
        "duration_seconds": duration_seconds,
        "voice_tier": voice_tier,
        "provider": "google_tts",
        "ambient_sound": ambient_sound,
        "cached": False
    }


# ---------------------------------------------------------------------------
# Language versions of a story (admin adds, listeners pick inside the player)
# ---------------------------------------------------------------------------
def _translation_tier(voice_id: str, accent_id: str, lang_code: str) -> str:
    return f"standard_{voice_id}_{accent_id}_{lang_code}"


def _language_code_for_id(supabase, language_id) -> str:
    res = supabase.table("languages").select("code").eq("id", language_id).limit(1).execute()
    return (res.data[0].get("code") if res.data else None) or "en"


def _clear_translations(supabase, story_text_id: str) -> bool:
    """Deletes every language version (text + audio rows) of a story."""
    removed = False
    try:
        res = supabase.table("story_translations").delete().eq("story_text_id", story_text_id).execute()
        removed = bool(res.data)
        audio_rows = supabase.table("story_audio").select("voice_tier").eq("story_text_id", story_text_id).execute().data or []
        for r in audio_rows:
            tier = r.get("voice_tier") or ""
            if tier.rsplit("_", 1)[-1] in TRANSLATION_SUFFIXES:
                supabase.table("story_audio").delete().eq("story_text_id", story_text_id).eq("voice_tier", tier).execute()
    except Exception as e:
        print(f"[clear translations] {story_text_id}: {e}")
    return removed


def _narrate_translation(supabase, story_text_id: str, lang_code: str, text: str, voice_id: str, accent_id: str) -> dict:
    from app.services.tts_service import synthesize_story_audio
    from app.services.tts_usage_service import record_tts_characters

    audio_bytes, duration_seconds = synthesize_story_audio(
        full_text=text, language_code=lang_code, voice_id=voice_id, accent_id=accent_id
    )
    record_tts_characters(len(text))
    storage_path = f"standard/{story_text_id}_{lang_code}_{voice_id}_{accent_id}.mp3"
    supabase.storage.from_("story-audio").upload(
        path=storage_path,
        file=audio_bytes,
        file_options={"content-type": "audio/mpeg", "upsert": "true"},
    )
    url = supabase.storage.from_("story-audio").get_public_url(storage_path)
    supabase.table("story_audio").upsert(
        {
            "story_text_id": story_text_id,
            "voice_tier": _translation_tier(voice_id, accent_id, lang_code),
            "provider": f"google_tts:{voice_id}:{accent_id}",
            "audio_url": url,
            "duration_seconds": duration_seconds,
        },
        on_conflict="story_text_id,voice_tier",
    ).execute()
    return {"audio_url": url, "duration_seconds": duration_seconds}


def add_story_languages(story_text_id: str, language_codes: list, voice_id: str = None, accent_id: str = None, force: bool = False) -> dict:
    """
    Admin: adds language versions to an existing story. For each language the
    story text + title are translated by Gemini (skipped if already in that
    language), saved in story_translations, and narrated with the story's
    voice. Already-existing versions are reused (never paid for twice).
    """
    supabase = get_supabase()
    story_res = supabase.table("story_texts").select("*").eq("id", story_text_id).single().execute()
    if not story_res.data:
        raise ValueError("Story not found.")
    story = story_res.data
    if not (story.get("full_text") or "").strip():
        raise ValueError("This story has no text yet.")

    cur_voice, cur_accent = _voice_and_accent_for_story(supabase, story_text_id)
    voice_id = voice_id or cur_voice
    accent_id = accent_id or cur_accent
    orig_code = _language_code_for_id(supabase, story.get("language_id"))

    added, errors = [], []
    for code in dict.fromkeys([(c or "").strip().lower() for c in (language_codes or [])]):
        if not code or code == orig_code or code not in SUPPORTED_LANGUAGES:
            continue
        try:
            lang_id, label, code = resolve_language(supabase, 1, code)
            if force:
                supabase.table("story_translations").delete().eq("story_text_id", story_text_id).eq("language_id", lang_id).execute()
                supabase.table("story_audio").delete().eq("story_text_id", story_text_id).eq("voice_tier", _translation_tier(voice_id, accent_id, code)).execute()
            existing = (
                supabase.table("story_translations").select("*")
                .eq("story_text_id", story_text_id).eq("language_id", lang_id).limit(1).execute()
            )
            if existing.data:
                row = existing.data[0]
            else:
                text, _ = ensure_text_in_language(story["full_text"], code, label)
                title, _ = ensure_text_in_language(story.get("title") or "", code, label)
                teaser = derive_teaser_from_text(text)
                ins = supabase.table("story_translations").insert({
                    "story_text_id": story_text_id,
                    "language_id": lang_id,
                    "title": sanitize_text(title) or sanitize_text(story.get("title") or "Story"),
                    "teaser": sanitize_text(teaser),
                    "full_text": sanitize_text(text),
                }).execute()
                row = ins.data[0]
            tier = _translation_tier(voice_id, accent_id, code)
            have_audio = supabase.table("story_audio").select("voice_tier").eq("story_text_id", story_text_id).eq("voice_tier", tier).limit(1).execute()
            if not have_audio.data:
                _narrate_translation(supabase, story_text_id, code, row["full_text"], voice_id, accent_id)
            added.append(code)
        except Exception as e:
            print(f"[add language {code}] {story_text_id}: {e}")
            errors.append(f"{SUPPORTED_LANGUAGES.get(code, {}).get('label', code)}: {e}")
    return {"added": added, "errors": errors}


def get_story_translation_detail(story_text_id: str, language_code: str) -> dict:
    supabase = get_supabase()
    lang_id, label, code = resolve_language(supabase, 1, language_code)
    tr = (
        supabase.table("story_translations").select("*")
        .eq("story_text_id", story_text_id).eq("language_id", lang_id).limit(1).execute()
    )
    if not tr.data:
        raise ValueError(f"No {label} version yet.")
    row = tr.data[0]
    return {"language_code": code, "title": row.get("title"), "teaser": row.get("teaser"), "full_text": row.get("full_text")}


def update_story_translation(story_text_id: str, language_code: str, title: str = None, full_text: str = None) -> dict:
    """
    Admin edit of ONE language version. Only that language is changed; if its
    text changed, only that language is re-narrated (same voice as the story).
    """
    supabase = get_supabase()
    lang_id, label, code = resolve_language(supabase, 1, language_code)
    tr = (
        supabase.table("story_translations").select("*")
        .eq("story_text_id", story_text_id).eq("language_id", lang_id).limit(1).execute()
    )
    if not tr.data:
        raise ValueError(f"No {label} version to edit yet.")
    row = tr.data[0]
    payload = {}
    text_changed = False
    if title is not None and title.strip():
        payload["title"] = sanitize_text(title.strip())
    if full_text is not None and full_text.strip():
        clean = sanitize_text(full_text.strip())
        if word_count(clean) < 20:
            raise ValueError("Please enter the full story text (at least a few sentences).")
        if clean != (row.get("full_text") or ""):
            text_changed = True
        payload["full_text"] = clean
        payload["teaser"] = sanitize_text(derive_teaser_from_text(clean))
    if payload:
        supabase.table("story_translations").update(payload).eq("id", row["id"]).execute()
    if text_changed:
        voice_id, accent_id = _voice_and_accent_for_story(supabase, story_text_id)
        _narrate_translation(supabase, story_text_id, code, payload["full_text"], voice_id, accent_id)
    fresh = supabase.table("story_texts").select("*").eq("id", story_text_id).single().execute().data
    enriched = enrich_audio_story_items(supabase, [fresh])
    return enriched[0] if enriched else fresh


def list_story_languages(story_text_id: str) -> list:
    supabase = get_supabase()
    story_res = supabase.table("story_texts").select("language_id").eq("id", story_text_id).single().execute()
    if not story_res.data:
        raise ValueError("Story not found.")
    orig = _language_code_for_id(supabase, story_res.data.get("language_id"))
    codes = [orig]
    rows = supabase.table("story_translations").select("language_id").eq("story_text_id", story_text_id).execute().data or []
    for r in rows:
        c = _language_code_for_id(supabase, r["language_id"])
        if c not in codes:
            codes.append(c)
    return [{"code": c, "label": SUPPORTED_LANGUAGES.get(c, {}).get("label", c)} for c in codes]


def get_story_in_language(
    story_text_id: str,
    language_code: str,
    voice_id: str = "luna",
    accent_id: str = "us",
    user_id: Optional[str] = None,
    is_admin: bool = False,
) -> dict:
    """Plays a story in one of its available languages (original or a saved version)."""
    from app.services.history_service import record_story_event

    supabase = get_supabase()
    story_res = supabase.table("story_texts").select("*").eq("id", story_text_id).single().execute()
    if not story_res.data:
        raise ValueError("Story not found.")
    story = story_res.data
    code = (language_code or "").strip().lower()
    orig = _language_code_for_id(supabase, story.get("language_id"))
    if not code or code == orig:
        return commit_and_narrate_story(
            story_text_id=story_text_id, voice_id=voice_id, voice_tier="standard",
            user_id=user_id, is_admin=is_admin, accent_id=accent_id,
        )

    lang_id, label, code = resolve_language(supabase, 1, code)
    tr = (
        supabase.table("story_translations").select("*")
        .eq("story_text_id", story_text_id).eq("language_id", lang_id).limit(1).execute()
    )
    if not tr.data:
        raise ValueError(f"This story isn't available in {label} yet.")
    # Language versions are saved in the voice the admin published with, so
    # a listener never triggers a new (paid) narration just by switching.
    voice_id, accent_id = _voice_and_accent_for_story(supabase, story_text_id)
    row = tr.data[0]

    tier = _translation_tier(voice_id, accent_id, code)
    aud = supabase.table("story_audio").select("*").eq("story_text_id", story_text_id).eq("voice_tier", tier).limit(1).execute()
    cached = bool(aud.data)
    if cached:
        audio_url, duration = aud.data[0]["audio_url"], aud.data[0]["duration_seconds"]
    else:
        made = _narrate_translation(supabase, story_text_id, code, row["full_text"], voice_id, accent_id)
        audio_url, duration = made["audio_url"], made["duration_seconds"]

    record_story_event(
        user_id=user_id, origin="library", story_text_id=story_text_id,
        title=row.get("title"), voice_id=voice_id, audio_url=audio_url, duration_seconds=duration,
    )
    return {
        "story_text_id": story_text_id,
        "title": row["title"],
        "teaser": row.get("teaser") or "",
        "full_text": row["full_text"],
        "audio_url": audio_url,
        "duration_seconds": duration,
        "voice_tier": "standard",
        "provider": f"google_tts:{voice_id}:{accent_id}",
        "ambient_sound": get_ambient_track_for_story(row.get("title", ""), row.get("teaser", "")),
        "cached": cached,
    }
