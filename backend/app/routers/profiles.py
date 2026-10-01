from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone

from app.db import get_supabase
from app.auth import get_current_user
from app.services.usage_service import check_and_increment_usage, get_monthly_usage

router = APIRouter(prefix="/api/profiles", tags=["Child Profiles"])


# --- Models ---

class CreateProfileRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    age_group_id: int
    language_id: int = 1
    avatar_url: Optional[str] = None
    narration_speed: Optional[float] = Field(default=1.0, ge=0.5, le=1.5)
    # Deep-sleeper guardrail: never let a profile's default timer exceed 15
    # minutes, so audio can't keep playing well past a napping child's
    # actual bedtime window.
    sleep_timer_minutes: Optional[int] = Field(default=None, ge=5, le=15)


class UpdateProfileRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=50)
    age_group_id: Optional[int] = None
    language_id: Optional[int] = None
    avatar_url: Optional[str] = None
    narration_speed: Optional[float] = Field(default=None, ge=0.5, le=1.5)
    sleep_timer_minutes: Optional[int] = Field(default=None, ge=5, le=15)


# --- Endpoints ---

@router.get("/")
def list_profiles(current_user: dict = Depends(get_current_user)):
    """Returns all child profiles for the authenticated user."""
    supabase = get_supabase()
    res = (
        supabase.table("child_profiles")
        .select("*, age_groups(label), languages(label, code)")
        .eq("user_id", current_user["id"])
        .neq("name", "_system_hidden")
        .neq("name", "Little Explorer")
        .execute()
    )
    return res.data or []


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_profile(payload: CreateProfileRequest, current_user: dict = Depends(get_current_user)):
    """
    Creates a child profile linked to the authenticated user.
    """
    supabase = get_supabase()
    tier = current_user.get("subscription_tier", "free")

    res = supabase.table("child_profiles").insert({
        "user_id": current_user["id"],
        "name": payload.name,
        "age_group_id": payload.age_group_id,
        "language_id": payload.language_id,
        "avatar_url": payload.avatar_url,
        "narration_speed": payload.narration_speed,
        "sleep_timer_minutes": payload.sleep_timer_minutes
    }).execute()

    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to create child profile.")

    return res.data[0]


@router.patch("/{profile_id}")
def update_profile(
    profile_id: str,
    payload: UpdateProfileRequest,
    current_user: dict = Depends(get_current_user)
):
    """Updates a child profile. Only the profile owner can update it."""
    supabase = get_supabase()

    # Verify ownership
    existing = supabase.table("child_profiles").select("id, user_id").eq("id", profile_id).single().execute()
    if not existing.data or existing.data["user_id"] != current_user["id"]:
        raise HTTPException(status_code=404, detail="Profile not found.")

    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        return existing.data

    res = supabase.table("child_profiles").update(updates).eq("id", profile_id).execute()
    return res.data[0] if res.data else {}


@router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_profile(profile_id: str, current_user: dict = Depends(get_current_user)):
    """Deletes a child profile owned by the authenticated user."""
    supabase = get_supabase()

    existing = supabase.table("child_profiles").select("id, user_id").eq("id", profile_id).single().execute()
    if not existing.data or existing.data["user_id"] != current_user["id"]:
        raise HTTPException(status_code=404, detail="Profile not found.")

    supabase.table("child_profiles").delete().eq("id", profile_id).execute()
    return


@router.get("/{profile_id}/usage")
def get_profile_usage(profile_id: str, current_user: dict = Depends(get_current_user)):
    """Returns the current month's usage counts for a child profile's parent account."""
    supabase = get_supabase()

    existing = supabase.table("child_profiles").select("id, user_id").eq("id", profile_id).single().execute()
    if not existing.data or existing.data["user_id"] != current_user["id"]:
        raise HTTPException(status_code=404, detail="Profile not found.")

    usage = get_monthly_usage(current_user["id"])
    tier = current_user.get("subscription_tier", "free")

    limits = {
        "free": {"personalization": 0, "voice_clone_story": 0},
        "premium": {"personalization": 10, "voice_clone_story": 5}
    }.get(tier, {"personalization": 0, "voice_clone_story": 0})

    return {
        "user_id": current_user["id"],
        "subscription_tier": tier,
        "current_month": usage,
        "limits": limits
    }
