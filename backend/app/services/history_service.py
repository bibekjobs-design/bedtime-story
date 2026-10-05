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
        supabase.table("story_events").insert({
            "user_id": user_id,
            "origin": origin,
            "story_text_id": story_text_id,
            "child_profile_id": child_profile_id,
            "title": title,
            "voice_id": voice_id,
            "voice_clone_id": voice_clone_id,
            "audio_url": audio_url,
            "duration_seconds": duration_seconds,
        }).execute()
    except Exception as e:
        print(f"[history_service] Failed to record story event (non-fatal): {e}")


def get_user_history(user_id: str, limit: int = 60) -> list:
    """
    Latest-first feed of this user's own narration events, for the History
    screen. Grouping by origin (library/ai/cloned) happens client-side, same
    as before, so the frontend shape barely changes.
    """
    supabase = get_supabase()
    res = (
        supabase.table("story_events")
        .select("id, story_text_id, child_profile_id, origin, title, voice_id, voice_clone_id, audio_url, duration_seconds, created_at")
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
