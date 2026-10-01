from fastapi import APIRouter, HTTPException, Query
from app.db import get_supabase

router = APIRouter(prefix="/api/lookups", tags=["Lookups"])

@router.get("/age-groups")
def get_age_groups():
    """Returns available age groups sorted by age range."""
    supabase = get_supabase()
    res = supabase.table("age_groups").select("*").order("sort_order").execute()
    return res.data

@router.get("/languages")
def get_languages():
    """Returns active languages for story narration."""
    supabase = get_supabase()
    res = supabase.table("languages").select("*").eq("is_active", True).execute()
    return res.data

@router.get("/categories")
def get_categories(age_group_id: int | None = Query(None, description="Optional filter by age group")):
    """
    Returns active story categories. If age_group_id is provided, returns
    categories mapped to that age group.
    """
    supabase = get_supabase()
    if age_group_id:
        links_res = supabase.table("category_age_groups").select("category_id").eq("age_group_id", age_group_id).execute()
        category_ids = [item["category_id"] for item in links_res.data]
        if not category_ids:
            return []
        res = supabase.table("story_categories").select("*").in_("id", category_ids).eq("is_active", True).execute()
        return res.data

    res = supabase.table("story_categories").select("*").eq("is_active", True).execute()
    return res.data


@router.get("/narrator-voices")
def get_narrator_voices():
    """
    Returns available Chirp3-HD narrator voices with tone, icon, and description.
    """
    from app.services.tts_service import NARRATOR_VOICES
    return list(NARRATOR_VOICES.values())


@router.get("/narrator-voices/{voice_id}/preview")
def get_voice_preview(voice_id: str, accent_id: str = Query("us", description="Accent/locale: us, gb, in, au")):
    """
    Returns a sample audio preview URL for the specified narrator voice, in
    the given accent.
    """
    from app.services.tts_service import get_or_create_voice_preview, NARRATOR_VOICES, ACCENTS
    if voice_id not in NARRATOR_VOICES:
        raise HTTPException(status_code=404, detail=f"Voice '{voice_id}' not found.")
    if accent_id not in ACCENTS:
        accent_id = "us"
    preview_url = get_or_create_voice_preview(voice_id, accent_id)
    return {"voice_id": voice_id, "accent_id": accent_id, "preview_url": preview_url}


@router.get("/accents")
def get_accents():
    """
    Returns the English accent/locale choices available for narration (US,
    UK, Indian, Australian) - each narrator persona (Luna/Oliver/Willow/
    Jasper) can be synthesized in any of these via Google TTS, no extra
    service or API involved.
    """
    from app.services.tts_service import ACCENTS
    return list(ACCENTS.values())
