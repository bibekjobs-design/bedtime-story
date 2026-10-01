"""
One-time library audit + backfill.

Walks every row in story_texts and makes sure it's actually playable:
  - generates full_text for any teaser-only / missing-text story (via Gemini)
  - runs the safety check on anything newly generated
  - synthesizes + caches "luna" narration audio for anything that doesn't
    have it yet, so the very first tap by ANY user is instant instead of
    waiting 30-40s for on-demand generation.

Safe to re-run: it only touches rows that are actually incomplete.
Run from the backend/ folder with the venv active:
    python backfill_library.py
"""
import sys
import time
import traceback

from app.db import get_supabase
from app.services.story_service import (
    generate_full_story_text,
    verify_content_safety,
    sanitize_text,
)
from app.services.tts_service import synthesize_story_audio

DEFAULT_VOICE = "luna"


def fetch_all(supabase, table, select, page_size=1000):
    rows = []
    start = 0
    while True:
        res = (
            supabase.table(table)
            .select(select)
            .range(start, start + page_size - 1)
            .execute()
        )
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        start += page_size
    return rows


def main():
    supabase = get_supabase()

    print("Fetching story_texts ...")
    stories = fetch_all(
        supabase,
        "story_texts",
        "id, title, teaser, full_text, generation_status, safety_check_status, "
        "category_id, age_group_id, language_id, times_served",
    )
    print(f"  {len(stories)} rows total")

    print("Fetching story_audio ...")
    audio_rows = fetch_all(supabase, "story_audio", "story_text_id, voice_tier, provider")
    audio_by_story = {}
    for r in audio_rows:
        audio_by_story.setdefault(r["story_text_id"], []).append(r)

    # Cache category / age / language labels to avoid refetching per story.
    cat_cache, age_cache, lang_cache = {}, {}, {}

    def category_name(cid):
        if not cid:
            return "Bedtime"
        if cid not in cat_cache:
            res = supabase.table("story_categories").select("name").eq("id", cid).single().execute()
            cat_cache[cid] = res.data["name"] if res.data else "Bedtime"
        return cat_cache[cid]

    def age_label(aid):
        if aid not in age_cache:
            res = supabase.table("age_groups").select("label").eq("id", aid).single().execute()
            age_cache[aid] = res.data["label"] if res.data else "kids"
        return age_cache[aid]

    def lang_label(lid):
        if lid not in lang_cache:
            res = supabase.table("languages").select("label").eq("id", lid).single().execute()
            lang_cache[lid] = res.data["label"] if res.data else "English"
        return lang_cache[lid]

    def lang_code(lid):
        if lid not in lang_cache.setdefault("_codes", {}):
            pass
        res = supabase.table("languages").select("code").eq("id", lid).single().execute()
        return res.data.get("code", "en") if res.data else "en"

    stats = {
        "already_ready": 0,
        "text_generated": 0,
        "audio_generated": 0,
        "safety_rejected": 0,
        "failed": 0,
    }
    failures = []

    total = len(stories)
    for idx, story in enumerate(stories, 1):
        sid = story["id"]
        title = story.get("title") or "(untitled)"
        has_luna_audio = any(
            "luna" in (a.get("voice_tier") or "") or "luna" in (a.get("provider") or "")
            for a in audio_by_story.get(sid, [])
        )
        needs_text = not story.get("full_text")
        needs_audio = not has_luna_audio

        if not needs_text and not needs_audio and story.get("generation_status") == "full_generated":
            stats["already_ready"] += 1
            continue

        if story.get("generation_status") == "safety_rejected":
            # Already flagged previously - skip, don't keep retrying it.
            continue

        print(f"[{idx}/{total}] Fixing '{title}' (needs_text={needs_text}, needs_audio={needs_audio}) ...")
        t0 = time.time()
        try:
            full_text = story.get("full_text")

            if needs_text:
                generated = generate_full_story_text(
                    title=title,
                    teaser=story.get("teaser", ""),
                    category_name=category_name(story.get("category_id")),
                    age_label=age_label(story["age_group_id"]),
                    language_label=lang_label(story["language_id"]),
                )
                generated = sanitize_text(generated)

                is_safe, notes = verify_content_safety(title, generated, age_label(story["age_group_id"]))
                if not is_safe:
                    supabase.table("story_texts").update({
                        "generation_status": "safety_rejected",
                        "safety_check_status": "failed",
                    }).eq("id", sid).execute()
                    stats["safety_rejected"] += 1
                    print(f"    -> REJECTED by safety check: {notes}")
                    continue

                supabase.table("story_texts").update({
                    "full_text": generated,
                    "generation_status": "full_generated",
                    "safety_check_status": "passed",
                }).eq("id", sid).execute()
                full_text = generated
                stats["text_generated"] += 1

            if needs_audio and full_text:
                audio_bytes, duration_seconds = synthesize_story_audio(
                    full_text=full_text,
                    language_code=lang_code(story["language_id"]),
                    voice_id=DEFAULT_VOICE,
                )
                storage_path = f"standard/{sid}_{DEFAULT_VOICE}.mp3"
                supabase.storage.from_("story-audio").upload(
                    path=storage_path,
                    file=audio_bytes,
                    file_options={"content-type": "audio/mpeg", "upsert": "true"},
                )
                public_audio_url = supabase.storage.from_("story-audio").get_public_url(storage_path)
                supabase.table("story_audio").upsert(
                    {
                        "story_text_id": sid,
                        "voice_tier": f"standard_{DEFAULT_VOICE}",
                        "provider": f"google_tts:{DEFAULT_VOICE}",
                        "audio_url": public_audio_url,
                        "duration_seconds": duration_seconds,
                    },
                    on_conflict="story_text_id,voice_tier",
                ).execute()
                if story.get("generation_status") != "full_generated":
                    supabase.table("story_texts").update({"generation_status": "full_generated"}).eq("id", sid).execute()
                stats["audio_generated"] += 1

            elapsed = time.time() - t0
            print(f"    -> done in {elapsed:.1f}s")

        except Exception as e:
            stats["failed"] += 1
            failures.append((title, sid, str(e)))
            print(f"    -> FAILED: {e}")
            traceback.print_exc()

    print("\n===== Library backfill complete =====")
    for k, v in stats.items():
        print(f"  {k}: {v}")
    if failures:
        print("\nFailed stories:")
        for title, sid, err in failures:
            print(f"  - {title} ({sid}): {err}")


if __name__ == "__main__":
    main()
