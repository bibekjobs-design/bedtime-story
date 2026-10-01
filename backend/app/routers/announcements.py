from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.auth import get_current_user_optional
from app.db import get_supabase
from app.services.subscription_policy import NORMAL_TIERS, PRO_TIERS

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
    if tier in PRO_TIERS:
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
        res = (
            get_supabase()
            .table("announcements")
            .select("id, title, message, icon, audience, action, action_label, starts_at, expires_at, created_at")
            .eq("is_active", True)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )
        audiences = _audiences_for(current_user)
        out = []
        for row in res.data or []:
            starts = _parse_dt(row.get("starts_at"))
            expires = _parse_dt(row.get("expires_at"))
            if starts and starts > now:
                continue
            if expires and expires <= now:
                continue
            if row.get("audience", "all") not in audiences:
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
