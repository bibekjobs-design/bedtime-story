"""Share-the-app links and in-app rating of STORYLAND (not of a single story).

GET  /api/app/links     public: share link / Play Store link / share message
POST /api/app/feedback  logged-in user: 1-5 stars + optional comment
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.config import settings
from app.db import get_supabase

router = APIRouter(prefix="/api/app", tags=["App"])


def _links() -> dict:
    play = (settings.PLAY_STORE_URL or "").strip()
    share = play or (settings.SHARE_URL or "").strip()
    msg = (settings.SHARE_MESSAGE or "").strip() or (
        "My child loves bedtime stories on STORYLAND - calming stories narrated in 5 languages, "
        "with a 30-day free trial. Try it:"
    )
    return {"share_url": share, "play_store_url": play, "share_message": msg}


@router.get("/links")
def get_links():
    return _links()


class FeedbackRequest(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    comment: Optional[str] = Field(None, max_length=1000)


@router.post("/feedback")
def send_feedback(payload: FeedbackRequest, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase()
    uid = current_user["id"]
    comment = (payload.comment or "").strip() or None
    try:
        # One rating per user: a new one replaces the old.
        supabase.table("app_feedback").delete().eq("user_id", uid).execute()
        supabase.table("app_feedback").insert(
            {"user_id": uid, "rating": payload.rating, "comment": comment}
        ).execute()
    except Exception as e:
        print(f"[app feedback] save failed: {e}")
        raise HTTPException(
            status_code=500,
            detail="Could not save your rating right now. Please try again later.",
        )
    links = _links()
    return {
        "ok": True,
        "ask_store_review": payload.rating >= 4 and bool(links["play_store_url"]),
        "play_store_url": links["play_store_url"],
    }
