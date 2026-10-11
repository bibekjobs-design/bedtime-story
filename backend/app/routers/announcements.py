from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from fastapi.responses import JSONResponse

from app.auth import get_current_user_optional, get_current_user, ADMIN_EMAILS
from app.db import get_supabase
from app.services.subscription_policy import NORMAL_TIERS, PRO_TIERS, SUPER_TIERS

router = APIRouter(prefix="/api/announcements", tags=["Announcements"])

MAX_RESULTS = 30


def _audiences_for(user) -> set:
    """Which `audience` values this caller should see. Logged-out visitors
    are treated like free users; admins see everything."""
    if not user:
        return {"all", "free"}
    tier = (user.get("subscription_tier") or "").lower().strip()
    if tier in ("admin", "admin_vip", "superadmin"):
        return {"all", "free", "normal", "pro"}
    if tier in SUPER_TIERS or tier in PRO_TIERS:
        # "pro" audience = anyone on a creating plan (Pro or Super)
        return {"all", "pro"}
    if tier in NORMAL_TIERS:
        return {"all", "normal"}
    return {"all", "free"}


def _parse_dt(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


class PublishAnnouncementRequest(BaseModel):
    message: str
    title: Optional[str] = None
    user_email: Optional[str] = None  # when set, only that user sees it


@router.post("")
def publish_announcement(payload: PublishAnnouncementRequest, current_user=Depends(get_current_user)):
    """Admin only: sends a notification (shown behind the bell) to ALL users."""
    email = (current_user.get("email") or "").lower().strip()
    tier = (current_user.get("subscription_tier") or "").lower().strip()
    if email not in {e.lower() for e in ADMIN_EMAILS} and tier not in ("admin", "admin_vip", "superadmin"):
        raise HTTPException(status_code=403, detail="Only the admin can publish notifications.")
    message = (payload.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Please write a message first.")
    if len(message) > 400:
        raise HTTPException(status_code=400, detail="Please keep the message under 400 characters.")
    title = (payload.title or "").strip()[:80] or "Message from STORYLAND"
    row = {
        "title": title,
        "message": message,
        "icon": "📢",
        "audience": "all",
        "is_active": True,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=14)).isoformat(),
    }
    target_email = (payload.user_email or "").strip().lower()
    target_name = None
    if target_email:
        found = (
            get_supabase().table("users").select("id, full_name, email")
            .ilike("email", target_email).limit(1).execute()
        )
        if not found.data:
            raise HTTPException(status_code=404, detail=f"No user found with the email {target_email}.")
        row["user_id"] = found.data[0]["id"]
        row["title"] = (payload.title or "").strip()[:80] or "A message for you from STORYLAND"
        target_name = found.data[0].get("full_name") or target_email
    try:
        res = get_supabase().table("announcements").insert(row).execute()
    except Exception as exc:
        if target_email:
            raise HTTPException(
                status_code=500,
                detail=f"Could not send the private message (has the user_id SQL been run?): {exc}",
            )
        raise HTTPException(status_code=500, detail=f"Could not publish the notification: {exc}")
    return {"ok": True, "id": (res.data or [{}])[0].get("id"), "sent_to": target_name}


@router.get("")
def list_announcements(current_user=Depends(get_current_user_optional)):
    """
    Active, in-window announcements for the bell on the Home screen, newest
    first. Public (works logged out); the caller's plan only decides which
    `audience` rows they see.

    Fails soft: if the table doesn't exist yet or the DB hiccups, returns an
    empty list so the app's Home screen never breaks over a notification.
    """
    try:
        now = datetime.now(timezone.utc)
        try:
            res = (
                get_supabase()
                .table("announcements")
                .select("id, title, message, icon, audience, action, action_label, starts_at, expires_at, created_at, user_id")
                .eq("is_active", True)
                .order("created_at", desc=True)
                .limit(100)
                .execute()
            )
        except Exception:
            # user_id column not added yet: behave exactly as before.
            res = (
                get_supabase()
                .table("announcements")
                .select("id, title, message, icon, audience, action, action_label, starts_at, expires_at, created_at")
                .eq("is_active", True)
                .order("created_at", desc=True)
                .limit(100)
                .execute()
            )
        my_id = str(current_user["id"]) if current_user else None
        audiences = _audiences_for(current_user)
        out = []
        for row in res.data or []:
            starts = _parse_dt(row.get("starts_at"))
            expires = _parse_dt(row.get("expires_at"))
            if starts and starts > now:
                continue
            if expires and expires <= now:
                continue
            # Private message: only its addressee (nobody else, not even admins).
            target = row.get("user_id")
            if target is not None and str(target) != my_id:
                continue
            if target is None and row.get("audience", "all") not in audiences:
                continue
            out.append({
                "id": row["id"],
                "title": row.get("title") or "",
                "message": row.get("message") or "",
                "icon": row.get("icon") or "🔔",
                "action": row.get("action"),
                "action_label": row.get("action_label"),
                "created_at": row.get("created_at"),
            })
            if len(out) >= MAX_RESULTS:
                break
        return JSONResponse(content=out, headers={"Cache-Control": "no-store"})
    except Exception as exc:
        print(f"[announcements] returning empty list: {exc}")
        return JSONResponse(content=[], headers={"Cache-Control": "no-store"})
