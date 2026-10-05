from fastapi import APIRouter, HTTPException, status, Depends, UploadFile, File, Form
from pydantic import BaseModel, Field
from typing import Optional, List

from app.db import get_supabase
from app.auth import get_current_user
from app.services.voice_clone_service import (
    register_parent_voice_clone,
    narrate_story_with_voice_clone
)

router = APIRouter(prefix="/api/voice-clones", tags=["Voice Clones"])


class NarrateClonedRequest(BaseModel):
    base_story_text_id: str
    voice_clone_id: str
    child_profile_id: Optional[str] = None


@router.get("/")
def list_voice_clones(current_user: dict = Depends(get_current_user)):
    """Lists all voice clones registered by the authenticated parent."""
    supabase = get_supabase()
    res = (
        supabase.table("voice_clones")
        .select("*")
        .eq("user_id", current_user["id"])
        .order("created_at", desc=False)
        .execute()
    )
    clones = res.data or []
    
    # Try listing files in user's voice-samples storage folder to find extensions
    try:
        storage_files = supabase.storage.from_("story-audio").list(f"voice-samples/{current_user['id']}")
        file_map = {f["name"].split(".")[0]: f["name"] for f in storage_files if "." in f.get("name", "")}
    except Exception:
        file_map = {}

    for c in clones:
        cid = c["id"]
        fname = file_map.get(cid, f"{cid}.webm")
        c["sample_audio_url"] = supabase.storage.from_("story-audio").get_public_url(
            f"voice-samples/{current_user['id']}/{fname}"
        )

    return clones


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_voice_clone(
    label: str = Form(..., description="e.g. 'Mom bedtime voice' or 'Dad'"),
    audio_file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """
    Uploads parent voice sample (MP3/WAV/M4A), stores in Supabase Storage,
    and registers with ElevenLabs voice cloning provider.
    Registering a clone is a real per-clone cost with ElevenLabs, so this is
    strictly a Premium feature (₹219/month) - free users can see the option
    but are asked to subscribe before we actually create the clone.
    """
    tier = current_user.get("subscription_tier", "free")
    email = (current_user.get("email") or "").lower().strip()
    is_admin = email in {"bibekjobs@gmail.com"} or tier in ("admin", "admin_vip", "superadmin")

    if not is_admin and tier not in ("premium", "premium_monthly", "premium_annual"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Voice cloning is a Super feature. Upgrade to the ₹219/month Super plan to clone your voice for bedtime stories!"
        )

    audio_bytes = await audio_file.read()
    if len(audio_bytes) < 1000:
        raise HTTPException(status_code=400, detail="Voice sample is too short. Please record at least 15-30 seconds.")

    ext = audio_file.filename.split(".")[-1].lower() if "." in (audio_file.filename or "") else "webm"

    try:
        res = await register_parent_voice_clone(
            user_id=current_user["id"],
            label=label,
            audio_bytes=audio_bytes,
            file_ext=ext
        )
        supabase = get_supabase()
        res["sample_audio_url"] = supabase.storage.from_("story-audio").get_public_url(
            f"voice-samples/{current_user['id']}/{res['id']}.{ext}"
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to register voice clone: {str(e)}")


@router.post("/narrate")
async def narrate_cloned(
    payload: NarrateClonedRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Generates bedtime narration using the parent's cloned voice,
    caching the result privately in personalized_stories.
    Strictly restricted to Premium subscribers (₹219/month).
    """
    tier = current_user.get("subscription_tier", "free")
    email = (current_user.get("email") or "").lower().strip()
    is_admin = email in {"bibekjobs@gmail.com"} or tier in ("admin", "admin_vip", "superadmin")
    
    if is_admin:
        tier = "admin_vip"

    if not is_admin and tier not in ("premium", "premium_monthly", "premium_annual"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Parent voice clone narration is a Super feature. Upgrade to the ₹219/month Super plan to narrate stories in your voice!"
        )

    try:
        res = await narrate_story_with_voice_clone(
            user_id=current_user["id"],
            subscription_tier=tier,
            child_profile_id=payload.child_profile_id,
            base_story_text_id=payload.base_story_text_id,
            voice_clone_id=payload.voice_clone_id,
            admin_test=is_admin
        )
        return res
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cloned narration failed: {str(e)}")


@router.delete("/{clone_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_voice_clone(clone_id: str, current_user: dict = Depends(get_current_user)):
    """Deletes a parent voice clone and removes its storage file."""
    supabase = get_supabase()
    existing = (
        supabase.table("voice_clones")
        .select("id, user_id")
        .eq("id", clone_id)
        .execute()
    )
    if not existing.data or existing.data[0]["user_id"] != current_user["id"]:
        # Idempotent return if already deleted
        return

    supabase.table("voice_clones").delete().eq("id", clone_id).execute()
    try:
        supabase.storage.from_("story-audio").remove([
            f"voice-samples/{current_user['id']}/{clone_id}.webm",
            f"voice-samples/{current_user['id']}/{clone_id}.mp3"
        ])
    except Exception:
        pass
    return
