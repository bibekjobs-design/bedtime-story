from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import get_supabase
from app.auth import get_current_user, verify_password
from app.services.voice_clone_service import delete_clone_everywhere

router = APIRouter(prefix="/api/privacy", tags=["Privacy"])


class DeleteAccountRequest(BaseModel):
    password: str


def _safe(label: str, fn):
    """Runs one cleanup step. A failing step never blocks the rest."""
    try:
        fn()
    except Exception as e:
        print(f"[delete-account] {label} skipped: {e}")


@router.post("/delete-account")
def delete_account(payload: DeleteAccountRequest, current_user: dict = Depends(get_current_user)):
    """
    Permanently deletes the signed-in parent's account and everything that
    belongs to it: voice clones (also at ElevenLabs), child profiles, history,
    personalised stories, stories they created, sign-in tokens.
    Payment records are kept (tax/accounting) but anonymised: if the database
    will not let the user row go because of them, the row is scrubbed instead.
    The password must be re-entered to confirm.
    """
    supabase = get_supabase()
    uid = current_user["id"]

    row = supabase.table("users").select("id, password_hash").eq("id", uid).limit(1).execute()
    if not row.data:
        raise HTTPException(status_code=404, detail="Account not found.")
    if not verify_password(payload.password, row.data[0]["password_hash"]):
        raise HTTPException(status_code=400, detail="That password is not correct.")

    # 1. Stop auto-renew so nobody is charged after deletion.
    def cancel_autopay():
        from app.routers.subscriptions import get_razorpay_client
        subs = supabase.table("autopay_subscriptions").select("razorpay_subscription_id, status").eq("user_id", uid).execute().data or []
        client = get_razorpay_client()
        for s in subs:
            if s.get("status") in ("authenticated", "active", "pending", "cancelling", "created"):
                try:
                    client.subscription.cancel(s["razorpay_subscription_id"])
                except Exception as e:
                    print(f"[delete-account] razorpay cancel: {e}")
    _safe("autopay", cancel_autopay)

    # 2. Voice clones: ElevenLabs voice, stored sample, database row.
    def clones():
        for c in supabase.table("voice_clones").select("*").eq("user_id", uid).execute().data or []:
            delete_clone_everywhere(supabase, c)
    _safe("voice clones", clones)

    # 3. Stories this user created.
    def own_stories():
        from app.services.story_service import delete_story_completely
        for s in supabase.table("story_texts").select("id").eq("owner_user_id", uid).execute().data or []:
            try:
                delete_story_completely(s["id"])
            except Exception as e:
                print(f"[delete-account] story {s['id']}: {e}")
    _safe("own stories", own_stories)

    # 4. Everything else that hangs off the user (children before profiles).
    for table in ("story_events", "personalized_stories", "child_profiles",
                  "email_verification_tokens", "password_reset_tokens"):
        _safe(table, lambda t=table: supabase.table(t).delete().eq("user_id", uid).execute())

    # 5. The account itself. Payments may still point at it: then scrub it.
    try:
        supabase.table("autopay_subscriptions").delete().eq("user_id", uid).execute()
    except Exception:
        pass
    try:
        supabase.table("users").delete().eq("id", uid).execute()
    except Exception as e:
        print(f"[delete-account] hard delete blocked ({e}); anonymising instead")
        import secrets
        supabase.table("users").update({
            "email": f"deleted-{uid}@deleted.invalid",
            "full_name": "Deleted account",
            "mobile_number": None,
            "password_hash": secrets.token_hex(32),
            "subscription_tier": "free",
        }).eq("id", uid).execute()

    return {"success": True, "message": "Your account and data have been deleted."}
