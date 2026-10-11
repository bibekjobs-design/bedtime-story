from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user, ADMIN_EMAILS
from app.db import get_supabase
from app.services.email_service import send_contact_message_email, _in_background

router = APIRouter(prefix="/api/support", tags=["Support"])

MAX_LEN = 1000
MAX_PER_HOUR = 5


def _is_admin(user: dict) -> bool:
    email = (user.get("email") or "").lower().strip()
    tier = (user.get("subscription_tier") or "").lower().strip()
    return email in {e.lower() for e in ADMIN_EMAILS} or tier in ("admin", "admin_vip", "superadmin")


class SupportMessageRequest(BaseModel):
    message: str


@router.post("/messages")
def send_support_message(payload: SupportMessageRequest, current_user: dict = Depends(get_current_user)):
    """A logged-in user writes to the admin. Saved in support_messages and
    emailed to the admin mailbox (reply in Gmail goes to the user)."""
    message = (payload.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Please write your message first.")
    if len(message) > MAX_LEN:
        raise HTTPException(status_code=400, detail=f"Please keep your message under {MAX_LEN} characters.")

    supabase = get_supabase()
    try:
        since = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        recent = (
            supabase.table("support_messages").select("id", count="exact")
            .eq("user_id", current_user["id"]).gte("created_at", since).execute()
        )
        if (recent.count or len(recent.data or [])) >= MAX_PER_HOUR:
            raise HTTPException(status_code=429, detail="You have sent several messages already. Please try again in an hour.")
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[support] rate check skipped: {exc}")

    name = current_user.get("full_name") or ""
    email = current_user.get("email") or ""
    plan = current_user.get("subscription_tier") or "free"
    try:
        supabase.table("support_messages").insert({
            "user_id": current_user["id"],
            "user_name": name,
            "user_email": email,
            "plan": plan,
            "message": message,
        }).execute()
    except Exception as exc:
        print(f"[support] could not save message: {exc}")
        raise HTTPException(status_code=500, detail="Sorry, we couldn't send your message. Please try again in a moment.")

    _in_background(send_contact_message_email, name, email, plan, message)
    return {"ok": True}


@router.get("/messages")
def list_support_messages(current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admins only.")
    res = (
        get_supabase().table("support_messages")
        .select("id, user_name, user_email, plan, message, is_read, created_at")
        .order("created_at", desc=True).limit(100).execute()
    )
    return res.data or []


@router.post("/messages/{message_id}/read")
def mark_support_message_read(message_id: str, current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admins only.")
    get_supabase().table("support_messages").update({"is_read": True}).eq("id", message_id).execute()
    return {"ok": True}
