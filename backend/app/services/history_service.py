"""
Server-side history + "my creations" ratings. Replaces the old device-local
AsyncStorage history (which was lost on cache clear, never synced across
devices, and silently capped at 30 entries).

One story_events row = one narration event, tagged by origin:
  - "library"         : a pre-made Library story was played
  - "create_narrator" : a parent generated a story from an uploaded file,
                         narrated by a premade AI voice - this ALSO lives in
                         the shared story_texts table, visible/searchable by
                         everyone (unchanged, existing behavior)
  - "create_clone"     : a parent's cloned voice narrated a story - private,
                          only ever queried for that same user_id
"""
from typing import Optional
from app.db import get_supabase


def record_story_event(
    user_id: Optional[str],
    origin: str,
    story_text_id: Optional[str] = None,
    child_profile_id: Optional[str] = None,
    title: Optional[str] = None,
    voice_id: Optional[str] = None,
    voice_clone_id: Optional[str] = None,
    audio_url: Optional[str] = None,
    duration_seconds: Optional[int] = None,
    expires_at: Optional[str] = None,
) -> None:
    """
    Best-effort log of a narration event. Never raises - a history-log
    failure should never block a parent from actually hearing their story.
    Silently no-ops for logged-out/anonymous plays (no user_id), since
    history is inherently a per-account feature.
    """
    if not user_id:
        return
    try:
        supabase = get_supabase()
        row = {
            "user_id": user_id,
            "origin": origin,
            "story_text_id": story_text_id,
            "child_profile_id": child_profile_id,
            "title": title,
            "voice_id": voice_id,
            "voice_clone_id": voice_clone_id,
            "audio_url": audio_url,
            "duration_seconds": duration_seconds,
        }
        if expires_at:
            try:
                supabase.table("story_events").insert({**row, "expires_at": expires_at}).execute()
                return
            except Exception as e:
                print(f"[history_service] expires_at not saved ({e}); saving without it")
        supabase.table("story_events").insert(row).execute()
    except Exception as e:
        print(f"[history_service] Failed to record story event (non-fatal): {e}")


def get_user_history(user_id: str, limit: int = 60) -> list:
    """
    Latest-first feed of this user's own narration events, for the History
    screen. Grouping by origin (library/ai/cloned) happens client-side, same
    as before, so the frontend shape barely changes.
    """
    supabase = get_supabase()
    cols = "id, story_text_id, child_profile_id, origin, title, voice_id, voice_clone_id, audio_url, duration_seconds, created_at"
    try:
        res = (
            supabase.table("story_events")
            .select(cols + ", expires_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception:
        # expires_at column not added yet (SQL 008 not run): history still works.
        res = (
            supabase.table("story_events")
            .select(cols)
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
    rows = res.data or []

    # Attach each story's cover picture (if it has one) so History can show
    # it. Read-only lookup; failures just mean cards use the placeholder.
    try:
        ids = list({r["story_text_id"] for r in rows if r.get("story_text_id")})
        if ids:
            covers = (
                supabase.table("story_texts")
                .select("id, cover_image_url")
                .in_("id", ids)
                .execute()
                .data
                or []
            )
            cover_by_id = {c["id"]: c.get("cover_image_url") for c in covers}
            for r in rows:
                r["cover_image_url"] = cover_by_id.get(r.get("story_text_id"))
    except Exception as e:
        print(f"[history_service] Could not attach cover pictures (non-fatal): {e}")

    return rows


def get_user_creations_with_ratings(user_id: str, limit: int = 60) -> list:
    """
    "My Creations": every shared (create_narrator) story this user has
    generated, with the CURRENT average_rating/total_ratings pulled live
    from story_texts - so a parent can see how many stars other users have
    given their uploaded stories. Cloned-voice events are deliberately
    excluded - they're private and never rated by strangers.
    """
    supabase = get_supabase()
    events = (
        supabase.table("story_events")
        .select("id, story_text_id, title, created_at")
        .eq("user_id", user_id)
        .eq("origin", "create_narrator")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
        or []
    )

    story_ids = [e["story_text_id"] for e in events if e.get("story_text_id")]
    ratings_by_id = {}
    if story_ids:
        stories = (
            supabase.table("story_texts")
            .select("id, title, average_rating, total_ratings, cover_image_url")
            .in_("id", story_ids)
            .execute()
            .data
            or []
        )
        ratings_by_id = {s["id"]: s for s in stories}

    results = []
    for e in events:
        sid = e.get("story_text_id")
        story = ratings_by_id.get(sid, {})
        results.append({
            "story_text_id": sid,
            "title": story.get("title") or e.get("title"),
            "cover_image_url": story.get("cover_image_url"),
            "created_at": e.get("created_at"),
            "average_rating": story.get("average_rating") or 0,
            "total_ratings": story.get("total_ratings") or 0,
        })
    return results


def delete_history_item(user_id: str, event_id: str) -> dict:
    """
    Removes one History card for this user (every replay of the same story),
    and for a cloned-voice story also its saved audio file and row. Only ever
    touches the caller's own rows. Library stories themselves are not deleted.
    """
    supabase = get_supabase()
    res = (
        supabase.table("story_events")
        .select("*")
        .eq("id", event_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise ValueError("History item not found.")
    ev = res.data[0]

    # Same card = same user + origin + story (or title) [+ same clone voice]
    q = supabase.table("story_events").select("id, audio_url").eq("user_id", user_id).eq("origin", ev.get("origin"))
    if ev.get("story_text_id"):
        q = q.eq("story_text_id", ev["story_text_id"])
    else:
        q = q.eq("title", ev.get("title"))
    if ev.get("origin") == "create_clone" and ev.get("voice_clone_id"):
        q = q.eq("voice_clone_id", ev["voice_clone_id"])
    group = q.execute().data or [ev]

    if ev.get("origin") == "create_clone":
        for row in group:
            url = row.get("audio_url") or ""
            if not url:
                continue
            try:
                if "/story-audio/" in url:
                    path = url.split("/story-audio/", 1)[1].split("?", 1)[0]
                    supabase.storage.from_("story-audio").remove([path])
            except Exception as e:
                print(f"[history] audio cleanup failed (non-fatal): {e}")
            try:
                supabase.table("personalized_stories").delete().eq("audio_url", url).execute()
            except Exception as e:
                print(f"[history] cloned story row cleanup failed (non-fatal): {e}")

    ids = [r["id"] for r in group]
    supabase.table("story_events").delete().in_("id", ids).eq("user_id", user_id).execute()
    return {"deleted": len(ids)}
