import re
from typing import Tuple
from google.cloud import texttospeech
from app.config import settings

# Reused across calls instead of created fresh every time. Building a new
# TextToSpeechClient() opens a new gRPC channel and reloads credentials each
# time - a few hundred ms of pure overhead per call that adds up fast when a
# screen previews several voice+accent combinations back to back.
_tts_client = None


def _get_tts_client():
    global _tts_client
    if _tts_client is None:
        _tts_client = texttospeech.TextToSpeechClient()
    return _tts_client

def chunk_text(text: str, max_chars: int = 4000) -> list[str]:
    """
    Splits long story text into natural paragraph/sentence chunks that fit within
    Google Cloud Text-to-Speech's 5000-character-per-request limit.
    """
    paragraphs = text.split("\n\n")
    chunks = []
    current_chunk = ""

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        if len(current_chunk) + len(para) + 2 <= max_chars:
            current_chunk = f"{current_chunk}\n\n{para}" if current_chunk else para
        else:
            if current_chunk:
                chunks.append(current_chunk)
            # If a single paragraph is longer than max_chars, split by sentences
            if len(para) > max_chars:
                sentences = re.split(r"(?<=[.!?])\s+", para)
                sub_chunk = ""
                for sent in sentences:
                    if len(sub_chunk) + len(sent) + 1 <= max_chars:
                        sub_chunk = f"{sub_chunk} {sent}" if sub_chunk else sent
                    else:
                        if sub_chunk:
                            chunks.append(sub_chunk)
                        sub_chunk = sent
                if sub_chunk:
                    chunks.append(sub_chunk)
                current_chunk = ""
            else:
                current_chunk = para

    if current_chunk:
        chunks.append(current_chunk)

    return chunks

NARRATOR_VOICES = {
    "luna": {
        "id": "luna",
        "name": "Luna",
        "icon": "🌸",
        "gender": "female",
        "voice_name": "en-US-Chirp3-HD-Aoede",
        "fallback_voice": "en-US-Journey-F",
        "tone": "Soft & Motherly",
        "description": "Warm, gentle & soothing female voice",
        "preview_text": "Close your eyes, little dreamer, and listen to the whisper of the stars."
    },
    "oliver": {
        "id": "oliver",
        "name": "Oliver",
        "icon": "🌲",
        "gender": "male",
        "voice_name": "en-US-Chirp3-HD-Charon",
        "fallback_voice": "en-US-Journey-D",
        "tone": "Deep & Gentle",
        "description": "Calm, protective & gentle fatherly voice",
        "preview_text": "Close your eyes, little dreamer, and listen to the whisper of the stars."
    },
    "willow": {
        "id": "willow",
        "name": "Willow",
        "icon": "🍃",
        "gender": "female",
        "voice_name": "en-US-Chirp3-HD-Kore",
        "fallback_voice": "en-US-Neural2-F",
        "tone": "Calm & Whispering",
        "description": "Peaceful, whispery & serene bedtime narrator",
        "preview_text": "Close your eyes, little dreamer, and listen to the whisper of the stars."
    },
    "jasper": {
        "id": "jasper",
        "name": "Jasper",
        "icon": "✨",
        "gender": "male",
        "voice_name": "en-US-Chirp3-HD-Puck",
        "fallback_voice": "en-US-Journey-O",
        "tone": "Storybook & Cozy",
        "description": "Whimsical, classic bedtime storyteller",
        "preview_text": "Close your eyes, little dreamer, and listen to the whisper of the stars."
    }
}

# Accent/locale choices for the English narrator voices above. Google's
# Chirp3-HD voices (and Neural2, used as the fallback) are available under
# several English locales using the SAME character name - e.g. "Aoede" (Luna)
# exists as en-US-Chirp3-HD-Aoede, en-GB-Chirp3-HD-Aoede, en-IN-Chirp3-HD-Aoede
# and en-AU-Chirp3-HD-Aoede. So the accent is just a locale swap on top of
# whichever narrator persona (Luna/Oliver/Willow/Jasper) is already chosen -
# no extra API, no extra cost, still Google TTS only. Only applies to English
# stories; Hindi narration below is unaffected (it always uses hi-IN voices).
ACCENTS = {
    "us": {"id": "us", "label": "US English", "flag": "🇺🇸", "locale": "en-US"},
    "gb": {"id": "gb", "label": "UK English", "flag": "🇬🇧", "locale": "en-GB"},
    "in": {"id": "in", "label": "Indian English", "flag": "🇮🇳", "locale": "en-IN"},
    "au": {"id": "au", "label": "Australian English", "flag": "🇦🇺", "locale": "en-AU"},
}


def _locale_for_accent(accent_id: str) -> str:
    return ACCENTS.get(accent_id, ACCENTS["us"])["locale"]


def _voice_name_for_locale(base_voice_name: str, locale: str) -> str:
    """
    Re-prefixes a voice name like "en-US-Chirp3-HD-Aoede" with a different
    locale, e.g. "en-IN-Chirp3-HD-Aoede" - the character name after the
    locale prefix stays the same across English locales.
    """
    if not base_voice_name:
        return base_voice_name
    parts = base_voice_name.split("-", 2)
    suffix = parts[2] if len(parts) == 3 else base_voice_name
    return f"{locale}-{suffix}"


def synthesize_story_audio(
    full_text: str,
    language_code: str = "en",
    voice_id: str = "luna",
    accent_id: str = "us"
) -> Tuple[bytes, int]:
    """
    Synthesizes bedtime narration audio using Google Cloud Text-to-Speech voices with parallel chunk processing and automatic fallback.
    `accent_id` picks the English locale (US/UK/India/Australia) for the
    chosen narrator persona - ignored for non-English (e.g. Hindi) narration.
    """
    import time
    from concurrent.futures import ThreadPoolExecutor

    client = _get_tts_client()

    voice_meta = NARRATOR_VOICES.get(voice_id, NARRATOR_VOICES["luna"])
    locale = _locale_for_accent(accent_id)
    gender_letter = "D" if voice_meta["gender"] == "male" else "F"
    candidate_voices = [
        _voice_name_for_locale(voice_meta.get("voice_name"), locale),
        f"{locale}-Neural2-{gender_letter}",
        "en-US-Neural2-D" if voice_meta["gender"] == "male" else "en-US-Neural2-F"
    ]

    chunks = chunk_text(full_text, max_chars=900)
    audio_segments = []

    for v_name in candidate_voices:
        if not v_name:
            continue
        try:
            if language_code.startswith("hi"):
                lang_tag = "hi-IN"
                actual_v_name = "hi-IN-Neural2-A" if voice_meta["gender"] == "female" else "hi-IN-Neural2-B"
                audio_config = texttospeech.AudioConfig(
                    audio_encoding=texttospeech.AudioEncoding.MP3,
                    speaking_rate=0.82,
                    pitch=-1.0
                )
            else:
                lang_tag = locale
                actual_v_name = v_name
                audio_config = texttospeech.AudioConfig(
                    audio_encoding=texttospeech.AudioEncoding.MP3,
                    speaking_rate=0.85,
                )

            voice = texttospeech.VoiceSelectionParams(
                language_code=lang_tag,
                name=actual_v_name
            )

            def _synthesize_chunk(chunk_str: str) -> bytes:
                s_input = texttospeech.SynthesisInput(text=chunk_str)
                resp = client.synthesize_speech(
                    input=s_input,
                    voice=voice,
                    audio_config=audio_config
                )
                return resp.audio_content

            if len(chunks) == 1:
                audio_segments = [_synthesize_chunk(chunks[0])]
            else:
                with ThreadPoolExecutor(max_workers=min(4, len(chunks))) as executor:
                    audio_segments = list(executor.map(_synthesize_chunk, chunks))

            if audio_segments:
                break
        except Exception as e:
            print(f"[TTS parallel synthesis notice with {v_name}] {e}. Trying fallback voice...")
            time.sleep(0.5)

    if not audio_segments:
        raise RuntimeError(f"TTS synthesis failed for voice '{voice_id}' across all candidate voices.")

    full_audio_bytes = b"".join(audio_segments)
    word_count = len(full_text.split())
    duration_seconds = max(10, int((word_count / 135.0) * 60))

    return full_audio_bytes, duration_seconds


def get_or_create_voice_preview(voice_id: str, accent_id: str = "us") -> str:
    """
    Returns a public preview audio URL for the given voice_id + accent_id.
    Synthesizes and caches into Supabase Storage under
    'voice-previews/{voice_id}-{accent_id}.mp3' - each accent gets its own
    cached preview clip so the dropdown can play a true sample of it.

    Checks the cache FIRST and only calls Google TTS (a real network round
    trip) the very first time a given voice+accent combination is previewed.
    Every combination after that is served straight from Supabase Storage in
    well under a second, instead of re-synthesizing on every single tap.
    """
    from app.db import get_supabase
    supabase = get_supabase()
    filename = f"{voice_id}-{accent_id}.mp3"
    storage_path = f"voice-previews/{filename}"

    try:
        existing_files = supabase.storage.from_("story-audio").list("voice-previews")
        already_cached = any((f or {}).get("name") == filename for f in (existing_files or []))
        if already_cached:
            return supabase.storage.from_("story-audio").get_public_url(storage_path)
    except Exception as e:
        # If the existence check itself fails (e.g. transient storage error),
        # fall through and just (re)synthesize rather than failing the preview.
        print(f"[Voice Preview Cache Check] {e}")

    try:
        voice_meta = NARRATOR_VOICES.get(voice_id, NARRATOR_VOICES["luna"])
        preview_text = voice_meta.get("preview_text", "Close your eyes, little dreamer, and listen to the stars.")
        audio_bytes, _ = synthesize_story_audio(preview_text, "en", voice_id, accent_id)

        supabase.storage.from_("story-audio").upload(
            path=storage_path,
            file=audio_bytes,
            file_options={"content-type": "audio/mpeg", "upsert": "true"}
        )
        return supabase.storage.from_("story-audio").get_public_url(storage_path)
    except Exception as e:
        print(f"[Voice Preview Synthesis] {e}")
        return ""
