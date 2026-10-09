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
                sentences = re.split(r"(?<=[.!?।॥])\s+", para)
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


# Indian-language narration. Hindi / Bengali / Kannada use Google's Chirp3-HD
# voices (same persona names as English: Aoede=Luna, Charon=Oliver, Kore=Willow,
# Puck=Jasper) with a Wavenet/Neural2 fallback. Odia is NOT in Chirp3-HD, so it
# is handled by Gemini-TTS instead.
INDIAN_LANGS = {
    "hi": {"locale": "hi-IN", "fallback_f": "hi-IN-Neural2-A", "fallback_m": "hi-IN-Neural2-B"},
    "bn": {"locale": "bn-IN", "fallback_f": "bn-IN-Wavenet-A", "fallback_m": "bn-IN-Wavenet-B"},
    "kn": {"locale": "kn-IN", "fallback_f": "kn-IN-Wavenet-A", "fallback_m": "kn-IN-Wavenet-B"},
    "te": {"locale": "te-IN", "fallback_f": "te-IN-Standard-A", "fallback_m": "te-IN-Standard-B"},
}
GEMINI_TTS_MODEL = "gemini-2.5-flash-tts"
GEMINI_VOICE_FOR_PERSONA = {"luna": "Aoede", "oliver": "Charon", "willow": "Kore", "jasper": "Puck"}
GEMINI_STYLE_PROMPT = "Read this aloud as a warm, gentle, soothing bedtime story for a young child, at a natural, gentle, calm pace - not slow."


def _lang_key(language_code: str) -> str:
    code = (language_code or "en").lower().split("-")[0]
    return code if code in INDIAN_LANGS else "en"


def synthesize_story_audio(
    full_text: str,
    language_code: str = "en",
    voice_id: str = "luna",
    accent_id: str = "us"
) -> Tuple[bytes, int]:
    """
    Synthesizes bedtime narration audio using Google Cloud Text-to-Speech with
    parallel chunk processing and automatic fallback voices.
    English: `accent_id` picks the locale (US/UK/India/Australia).
    Hindi/Bengali/Kannada: Chirp3-HD voice of the chosen persona (accent ignored).
    Odia: Gemini-TTS voice of the chosen persona (accent ignored).
    """
    import time
    from concurrent.futures import ThreadPoolExecutor

    client = _get_tts_client()

    voice_meta = NARRATOR_VOICES.get(voice_id, NARRATOR_VOICES["luna"])
    lang = _lang_key(language_code)
    is_male = voice_meta["gender"] == "male"

    # Each candidate = (language_tag, voice_name, model_name_or_None, use_style_prompt)
    candidates = []
    if lang == "en":
        locale = _locale_for_accent(accent_id)
        gender_letter = "D" if is_male else "F"
        candidates.append((locale, _voice_name_for_locale(voice_meta.get("voice_name"), locale), None, False))
        candidates.append((locale, f"{locale}-Neural2-{gender_letter}", None, False))
        candidates.append(("en-US", "en-US-Neural2-D" if is_male else "en-US-Neural2-F", None, False))
        max_chars = 900
        speaking_rate = 0.97
    else:
        cfg = INDIAN_LANGS[lang]
        locale = cfg["locale"]
        if cfg.get("gemini"):
            _gv = GEMINI_VOICE_FOR_PERSONA.get(voice_id, "Aoede")
            candidates.append((locale, _gv, GEMINI_TTS_MODEL, True))
            candidates.append((locale, _gv, "gemini-2.5-pro-tts", True))
            max_chars = 700  # Odia is 3 bytes/char in UTF-8; Gemini-TTS limit is 4000 bytes
        else:
            persona = (voice_meta.get("voice_name") or "en-US-Chirp3-HD-Aoede").split("-", 2)[-1]
            candidates.append((locale, f"{locale}-{persona}", None, False))
            candidates.append((locale, cfg["fallback_m"] if is_male else cfg["fallback_f"], None, False))
            max_chars = 700
        speaking_rate = 0.97

    chunks = chunk_text(full_text, max_chars=max_chars)
    audio_segments = []
    last_error = None

    for lang_tag, v_name, model_name, use_prompt in candidates:
        try:
            if model_name:
                voice = texttospeech.VoiceSelectionParams(
                    language_code=lang_tag, name=v_name, model_name=model_name
                )
                # Gemini-TTS does not use speaking_rate; style comes from the prompt.
                audio_config = texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3)
            else:
                voice = texttospeech.VoiceSelectionParams(language_code=lang_tag, name=v_name)
                audio_config = texttospeech.AudioConfig(
                    audio_encoding=texttospeech.AudioEncoding.MP3,
                    speaking_rate=speaking_rate,
                )

            def _synthesize_chunk(chunk_str: str, _voice=voice, _cfg=audio_config, _prompt=use_prompt) -> bytes:
                if _prompt:
                    s_input = texttospeech.SynthesisInput(text=chunk_str, prompt=GEMINI_STYLE_PROMPT)
                else:
                    s_input = texttospeech.SynthesisInput(text=chunk_str)
                for attempt in range(3):
                    try:
                        resp = client.synthesize_speech(input=s_input, voice=_voice, audio_config=_cfg)
                        return resp.audio_content
                    except Exception:
                        if attempt == 2:
                            raise
                        time.sleep(1.5 * (attempt + 1))

            workers = 2 if model_name else 4
            if len(chunks) == 1:
                audio_segments = [_synthesize_chunk(chunks[0])]
            else:
                with ThreadPoolExecutor(max_workers=min(workers, len(chunks))) as executor:
                    audio_segments = list(executor.map(_synthesize_chunk, chunks))

            if audio_segments:
                break
        except Exception as e:
            last_error = e
            print(f"[TTS synthesis notice with {v_name}] {e}. Trying fallback voice...")
            audio_segments = []
            time.sleep(0.5)

    if not audio_segments:
        raise RuntimeError(
            f"TTS synthesis failed for voice '{voice_id}' in language '{lang}' across all candidate voices. {last_error or ''}"
        )

    full_audio_bytes = b"".join(audio_segments)
    word_count = len(full_text.split())
    duration_seconds = max(10, int((word_count / 150.0) * 60))

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
