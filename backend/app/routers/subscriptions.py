import hashlib
import hmac
import json
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, status, Depends, Request
from pydantic import BaseModel, Field
import razorpay
from razorpay.errors import SignatureVerificationError

from app.db import get_supabase
from app.auth import get_current_user
from app.config import settings
from app.services.subscription_policy import (
    NORMAL_PLAN_PRICE_INR,
    PRO_PLAN_PRICE_INR,
    PRO_PLAN_ORIGINAL_PRICE_INR,
    NORMAL_TIER_NAME,
    PRO_TIER_NAME,
    PAID_DURATION_DAYS,
    PRO_TIERS,
    PAID_TIERS,
    get_trial_info,
    plan_for_amount,
)

router = APIRouter(prefix="/api/subscriptions", tags=["Subscriptions & Payments"])

# Kept for backwards compatibility with any older client still reading these
# names; new code should use the plan-specific constants from
# subscription_policy instead.
PLAN_PRICE_INR = PRO_PLAN_PRICE_INR
PREMIUM_DURATION_DAYS = PAID_DURATION_DAYS

ADMIN_EMAILS = {"bibekjobs@gmail.com"}


def is_admin_account(user: dict) -> bool:
    email = (user.get("email") or "").lower().strip()
    tier = (user.get("subscription_tier") or "").lower().strip()
    return email in ADMIN_EMAILS or tier in ("admin", "admin_vip", "superadmin")


def get_razorpay_client() -> razorpay.Client:
    if not settings.RAZORPAY_KEY_ID or not settings.RAZORPAY_KEY_SECRET:
        raise HTTPException(
            status_code=500,
            detail="Razorpay is not configured on the server (missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).",
        )
    return razorpay.Client(auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET))


class SubscriptionStatusResponse(BaseModel):
    user_id: str
    subscription_tier: str
    plan_tier: str = "free"  # "trial" | "free_expired" | "normal" | "pro" | "admin"
    is_subscribed: bool
    is_trial_active: bool
    trial_ends_at: Optional[str] = None
    trial_hours_left: int = 0
    trial_days_left: int = 0
    trial_duration_days: int = 15
    plan_name: str = "Bedtime Story"
    plan_price_inr: int = PRO_PLAN_PRICE_INR
    normal_plan_price_inr: int = NORMAL_PLAN_PRICE_INR
    pro_plan_price_inr: int = PRO_PLAN_PRICE_INR
    pro_plan_original_price_inr: int = PRO_PLAN_ORIGINAL_PRICE_INR
    can_generate_stories: bool
    can_clone_voices: bool
    subscription_expires_at: Optional[str] = None
    # Auto-renew (Razorpay Subscriptions): None | "active" | "cancelling" | ...
    autopay_status: Optional[str] = None
    autopay_plan: Optional[str] = None


@router.get("/status", response_model=SubscriptionStatusResponse)
def get_subscription_status(current_user: dict = Depends(get_current_user)):
    """
    Returns the user's free-trial status and active plan.
      - New trial: 15 days. Existing (pre-cutover) accounts keep their
        original 30-day trial (grandfathered).
      - After the trial lapses with no payment: Create is locked (0 custom
        stories, 0 clones) but the Library stays free to browse forever.
      - Normal (Rs 99/month): 3 stories/month (~3 min each), no voice cloning.
      - Pro (Rs 219/month, shown as a discount off Rs 299): 8 stories/month
        (~5 min each) + 4 cloned-voice narrations/month (~3 min each).
    Admin accounts (bibekjobs@gmail.com) get permanent VIP Pro access.
    get_current_user() already downgrades an expired paid tier back to
    "free" before this ever runs, so subscription_tier here is always current.
    """
    tier = current_user.get("subscription_tier", "free")
    is_admin = is_admin_account(current_user)
    is_subscribed = is_admin or tier in PAID_TIERS

    if is_admin:
        return {
            "user_id": current_user["id"],
            "subscription_tier": "admin_vip",
            "plan_tier": "admin",
            "is_subscribed": True,
            "is_trial_active": False,
            "trial_ends_at": None,
            "trial_hours_left": 9999,
            "trial_days_left": 999,
            "trial_duration_days": 0,
            "plan_name": "Admin VIP Lifetime Access",
            "plan_price_inr": 0,
            "normal_plan_price_inr": NORMAL_PLAN_PRICE_INR,
            "pro_plan_price_inr": PRO_PLAN_PRICE_INR,
            "pro_plan_original_price_inr": PRO_PLAN_ORIGINAL_PRICE_INR,
            "can_generate_stories": True,
            "can_clone_voices": True,
            "subscription_expires_at": None,
        }

    trial_info = get_trial_info(current_user.get("created_at"))
    is_trial_active = (not is_subscribed) and trial_info["is_trial_active"]

    can_generate = is_subscribed or is_trial_active
    can_clone = is_admin or tier in PRO_TIERS

    if is_subscribed:
        plan_tier = "pro" if tier in PRO_TIERS else "normal"
        plan_name = "Bedtime Story Pro" if tier in PRO_TIERS else "Bedtime Story Normal"
        plan_price = PRO_PLAN_PRICE_INR if tier in PRO_TIERS else NORMAL_PLAN_PRICE_INR
    elif is_trial_active:
        plan_tier = "trial"
        plan_name = "Free Trial"
        plan_price = 0
    else:
        plan_tier = "free_expired"
        plan_name = "Free (trial ended)"
        plan_price = 0

    return {
        "user_id": current_user["id"],
        "subscription_tier": tier,
        "plan_tier": plan_tier,
        "is_subscribed": is_subscribed,
        "is_trial_active": is_trial_active,
        "trial_ends_at": trial_info["trial_ends_at"],
        "trial_hours_left": trial_info["hours_left"],
        "trial_days_left": trial_info["days_left"],
        "trial_duration_days": trial_info["trial_duration_days"],
        "plan_name": plan_name,
        "plan_price_inr": plan_price,
        "normal_plan_price_inr": NORMAL_PLAN_PRICE_INR,
        "pro_plan_price_inr": PRO_PLAN_PRICE_INR,
        "pro_plan_original_price_inr": PRO_PLAN_ORIGINAL_PRICE_INR,
        "can_generate_stories": can_generate,
        "can_clone_voices": can_clone,
        "subscription_expires_at": current_user.get("subscription_expires_at"),
        **_autopay_info(current_user["id"]),
    }


class CreateOrderRequest(BaseModel):
    # "normal_monthly" (Rs 99) or "pro_monthly" / "monthly_199" (Rs 219,
    # kept for backwards compatibility with older clients). Anything
    # unrecognized defaults to Pro.
    plan_id: Optional[str] = "pro_monthly"


class CreateOrderResponse(BaseModel):
    order_id: str
    plan_id: str
    amount_inr: int
    amount_paise: int
    currency: str
    razorpay_key_id: str
    prefill_email: Optional[str] = None
    prefill_name: Optional[str] = None
    prefill_contact: Optional[str] = None


def _resolve_plan(plan_id: Optional[str]) -> tuple:
    """Returns (normalized_plan_id, amount_inr) for a requested plan_id."""
    normalized = (plan_id or "pro_monthly").lower().strip()
    if normalized in ("normal_monthly", "normal", "monthly_51", "monthly_99"):
        return "normal_monthly", NORMAL_PLAN_PRICE_INR
    return "pro_monthly", PRO_PLAN_PRICE_INR


@router.post("/create-order", response_model=CreateOrderResponse)
def create_subscription_order(
    payload: CreateOrderRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Creates a REAL Razorpay Order for a one-time charge against whichever
    plan the parent picked (Normal Rs 99 or Pro Rs 219). The frontend opens
    Razorpay's own hosted Checkout against this order_id - no fabricated
    UPI links or third-party QR images. A `payments` row is logged up front
    (with the exact amount_inr for this plan) so we can reconcile even if
    the client never calls /verify-payment (the /webhook endpoint below is
    the durable fallback) - and so /verify-payment and /webhook can grant
    the CORRECT tier just by reading back what was actually charged.
    """
    client = get_razorpay_client()
    supabase = get_supabase()
    plan_id, amount_inr = _resolve_plan(payload.plan_id)
    amount_paise = amount_inr * 100
    receipt = f"sub_{current_user['id'][:8]}_{uuid.uuid4().hex[:8]}"

    try:
        order = client.order.create({
            "amount": amount_paise,
            "currency": "INR",
            "receipt": receipt,
            "notes": {
                "user_id": current_user["id"],
                "email": current_user.get("email", ""),
                "plan": plan_id,
            },
        })
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Razorpay order creation failed: {exc}")

    supabase.table("payments").insert({
        "user_id": current_user["id"],
        "razorpay_order_id": order["id"],
        "amount_inr": amount_inr,
        "status": "created",
    }).execute()

    return {
        "order_id": order["id"],
        "plan_id": plan_id,
        "amount_inr": amount_inr,
        "amount_paise": amount_paise,
        "currency": "INR",
        "razorpay_key_id": settings.RAZORPAY_KEY_ID,
        "prefill_email": current_user.get("email"),
        "prefill_name": current_user.get("full_name"),
        "prefill_contact": current_user.get("mobile_number"),
    }


# ---------------------------------------------------------------------------
# Auto-renew (Razorpay Subscriptions)
#
# Alongside the one-time "pay for 1 month" Orders flow above, a parent can
# choose "Subscribe monthly": Razorpay saves a mandate (UPI AutoPay / card)
# once and then charges the plan every month. Each successful charge fires
# the `subscription.charged` webhook, which pushes subscription_expires_at
# forward. If the parent cancels, or a charge ultimately fails, no further
# extension happens and the plan simply lapses at the end of the paid period
# (get_current_user() downgrades an expired tier automatically).
#
# Expiry is always set to Razorpay's own `current_end` for the subscription
# (+ a small grace window), i.e. an ABSOLUTE date - so the client-confirm
# path and the webhook path can both run for the same charge without ever
# double-adding days.
# ---------------------------------------------------------------------------
AUTOPAY_TOTAL_COUNT = 60      # billing cycles the mandate covers (5 years of months)
AUTOPAY_GRACE_DAYS = 2        # keep access this long past current_end, in case a renewal posts late
LIVE_AUTOPAY_STATUSES = ("authenticated", "active", "pending", "cancelling")


def _razorpay_plan_id(plan_id: str) -> str:
    """Maps our plan id to the Razorpay Subscriptions plan created in the dashboard."""
    rp_plan = settings.RAZORPAY_PLAN_ID_NORMAL if plan_id == "normal_monthly" else settings.RAZORPAY_PLAN_ID_PRO
    if not rp_plan:
        raise HTTPException(status_code=500, detail="Auto-renew isn't configured on the server (missing Razorpay plan id).")
    return rp_plan


def _live_autopay_row(supabase, user_id: str):
    res = (
        supabase.table("autopay_subscriptions")
        .select("*")
        .eq("user_id", user_id)
        .in_("status", list(LIVE_AUTOPAY_STATUSES))
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def _autopay_info(user_id: str) -> dict:
    """autopay_status / autopay_plan for /status. Fails soft (e.g. table not created yet)."""
    try:
        row = _live_autopay_row(get_supabase(), user_id)
        if row:
            return {"autopay_status": row.get("status"), "autopay_plan": row.get("plan")}
    except Exception as exc:
        print(f"[autopay] status lookup skipped: {exc}")
    return {"autopay_status": None, "autopay_plan": None}


def _epoch_to_dt(value):
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError):
        return None


def _grant_from_subscription(client, supabase, subscription_id: str, payment_entity: dict) -> Optional[datetime]:
    """
    Grants/extends the paid plan for a captured subscription charge. Safe to
    call more than once for the same charge (absolute expiry + payment-id
    check). Returns the new expiry, or None if nothing was granted.
    """
    row = (
        supabase.table("autopay_subscriptions")
        .select("*")
        .eq("razorpay_subscription_id", subscription_id)
        .execute()
    )
    if not row.data:
        return None
    sub_row = row.data[0]
    user_id = sub_row["user_id"]
    granted_tier = NORMAL_TIER_NAME if sub_row.get("plan") == "normal_monthly" else PRO_TIER_NAME

    rp_sub = client.subscription.fetch(subscription_id)
    rp_status = rp_sub.get("status")
    if rp_status in ("halted", "expired"):
        return None  # a dead subscription must never grant access

    current_end = _epoch_to_dt(rp_sub.get("current_end"))
    base_end = current_end or (datetime.now(timezone.utc) + timedelta(days=PAID_DURATION_DAYS))
    expires_at = base_end + timedelta(days=AUTOPAY_GRACE_DAYS)

    payment_id = payment_entity.get("id")
    amount_inr = int(round((payment_entity.get("amount") or 0) / 100)) or sub_row.get("amount_inr") or 0
    if payment_id:
        existing = supabase.table("payments").select("id").eq("razorpay_payment_id", payment_id).execute()
        if not existing.data:
            supabase.table("payments").insert({
                "user_id": user_id,
                "razorpay_order_id": payment_entity.get("order_id") or payment_id,
                "razorpay_payment_id": payment_id,
                "amount_inr": amount_inr,
                "status": "captured",
                "captured_at": datetime.now(timezone.utc).isoformat(),
                "premium_expires_at": expires_at.isoformat(),
            }).execute()

    supabase.table("users").update({
        "subscription_tier": granted_tier,
        "subscription_expires_at": expires_at.isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", user_id).execute()

    new_status = "cancelling" if sub_row.get("status") == "cancelling" else (rp_status or "active")
    supabase.table("autopay_subscriptions").update({
        "status": new_status,
        "current_end": current_end.isoformat() if current_end else None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("razorpay_subscription_id", subscription_id).execute()
    return expires_at


class CreateAutopayResponse(BaseModel):
    subscription_id: str
    plan_id: str
    amount_inr: int
    currency: str = "INR"
    razorpay_key_id: str
    prefill_email: Optional[str] = None
    prefill_name: Optional[str] = None
    prefill_contact: Optional[str] = None


@router.post("/create-autopay", response_model=CreateAutopayResponse)
def create_autopay_subscription(
    payload: CreateOrderRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Starts a Razorpay auto-renew subscription for the chosen plan. The app
    opens Razorpay Checkout with the returned subscription_id; the parent
    approves the monthly mandate once. Nothing is granted here - access
    starts when the first charge is confirmed (/verify-autopay or webhook).
    """
    client = get_razorpay_client()
    supabase = get_supabase()
    plan_id, amount_inr = _resolve_plan(payload.plan_id)

    if _live_autopay_row(supabase, current_user["id"]):
        raise HTTPException(
            status_code=409,
            detail="Auto-renew is already on for your account. Cancel it first if you want to change plans.",
        )

    try:
        sub = client.subscription.create({
            "plan_id": _razorpay_plan_id(plan_id),
            "total_count": AUTOPAY_TOTAL_COUNT,
            "quantity": 1,
            "customer_notify": 1,
            "notes": {
                "user_id": current_user["id"],
                "email": current_user.get("email", ""),
                "plan": plan_id,
            },
        })
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Razorpay subscription creation failed: {exc}")

    supabase.table("autopay_subscriptions").insert({
        "user_id": current_user["id"],
        "razorpay_subscription_id": sub["id"],
        "plan": plan_id,
        "amount_inr": amount_inr,
        "status": sub.get("status", "created"),
    }).execute()

    return {
        "subscription_id": sub["id"],
        "plan_id": plan_id,
        "amount_inr": amount_inr,
        "currency": "INR",
        "razorpay_key_id": settings.RAZORPAY_KEY_ID,
        "prefill_email": current_user.get("email"),
        "prefill_name": current_user.get("full_name"),
        "prefill_contact": current_user.get("mobile_number"),
    }


class VerifyAutopayRequest(BaseModel):
    razorpay_payment_id: str
    razorpay_subscription_id: str
    razorpay_signature: str


@router.post("/verify-autopay")
def verify_autopay(
    payload: VerifyAutopayRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Client-side confirmation after the parent approves the mandate and the
    first charge goes through. Checks Razorpay's signature (for
    subscriptions it signs payment_id|subscription_id), confirms the
    subscription belongs to this user, confirms the payment is captured
    with Razorpay directly, then activates the plan. The webhook is the
    durable fallback if the app closes before this runs.
    """
    client = get_razorpay_client()
    supabase = get_supabase()

    expected = hmac.new(
        settings.RAZORPAY_KEY_SECRET.encode("utf-8"),
        f"{payload.razorpay_payment_id}|{payload.razorpay_subscription_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, payload.razorpay_signature):
        raise HTTPException(status_code=400, detail="Payment verification failed: invalid signature.")

    row = (
        supabase.table("autopay_subscriptions")
        .select("*")
        .eq("razorpay_subscription_id", payload.razorpay_subscription_id)
        .execute()
    )
    if not row.data:
        raise HTTPException(status_code=404, detail="Unknown subscription - it was not created by this server.")
    if row.data[0]["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="This subscription does not belong to your account.")

    try:
        rp_payment = client.payment.fetch(payload.razorpay_payment_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not confirm payment with Razorpay: {exc}")

    if rp_payment.get("status") != "captured":
        raise HTTPException(
            status_code=402,
            detail=f"Payment not completed yet (Razorpay status: {rp_payment.get('status')}). "
                   "If it goes through, your plan will activate automatically.",
        )

    try:
        expires_at = _grant_from_subscription(client, supabase, payload.razorpay_subscription_id, rp_payment)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not activate the subscription: {exc}")
    if not expires_at:
        raise HTTPException(status_code=409, detail="This subscription is no longer active.")

    plan_key = row.data[0].get("plan")
    granted_tier = NORMAL_TIER_NAME if plan_key == "normal_monthly" else PRO_TIER_NAME
    is_pro = granted_tier == PRO_TIER_NAME
    return {
        "success": True,
        "message": f"Subscription active! {'Pro' if is_pro else 'Normal'} renews automatically every month.",
        "subscription_tier": granted_tier,
        "is_subscribed": True,
        "expires_at": expires_at.isoformat(),
        "autopay": True,
    }


@router.post("/cancel-autopay")
def cancel_autopay(current_user: dict = Depends(get_current_user)):
    """
    Turns auto-renew off. The plan the parent already paid for stays active
    until the end of the current period; it just won't renew.
    """
    client = get_razorpay_client()
    supabase = get_supabase()
    row = _live_autopay_row(supabase, current_user["id"])
    if not row:
        raise HTTPException(status_code=404, detail="No active auto-renew subscription found.")

    sub_id = row["razorpay_subscription_id"]
    started = row.get("status") == "active"
    try:
        if started:
            client.subscription.cancel(sub_id, {"cancel_at_cycle_end": 1})
            new_status = "cancelling"
        else:
            client.subscription.cancel(sub_id)  # never charged yet: cancel outright
            new_status = "cancelled"
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Razorpay could not cancel the subscription: {exc}")

    supabase.table("autopay_subscriptions").update({
        "status": new_status,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("razorpay_subscription_id", sub_id).execute()

    return {
        "success": True,
        "autopay_status": new_status,
        "access_until": current_user.get("subscription_expires_at"),
        "message": "Auto-renew is off. Your plan stays active until the end of the period you've paid for.",
    }


class VerifyPaymentRequest(BaseModel):
    razorpay_order_id: str = Field(..., description="order_id returned by /create-order")
    razorpay_payment_id: str = Field(..., description="payment_id returned by Razorpay Checkout's success handler")
    razorpay_signature: str = Field(..., description="signature returned by Razorpay Checkout's success handler")


@router.post("/verify-payment")
def verify_subscription_payment(
    payload: VerifyPaymentRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Verifies the HMAC signature Razorpay Checkout hands back, confirms the
    order belongs to this user, double-checks the payment's real status
    directly with Razorpay's API (never trust the client alone), then
    activates 30 days of Premium. This is the client-side confirmation path;
    /webhook below is the server-to-server path that covers a client that
    closes the app before this ever gets called.
    """
    client = get_razorpay_client()
    supabase = get_supabase()

    try:
        client.utility.verify_payment_signature({
            "razorpay_order_id": payload.razorpay_order_id,
            "razorpay_payment_id": payload.razorpay_payment_id,
            "razorpay_signature": payload.razorpay_signature,
        })
    except SignatureVerificationError:
        supabase.table("payments").update({
            "status": "signature_failed",
            "razorpay_payment_id": payload.razorpay_payment_id,
        }).eq("razorpay_order_id", payload.razorpay_order_id).execute()
        raise HTTPException(status_code=400, detail="Payment verification failed: invalid signature.")

    order_row = (
        supabase.table("payments")
        .select("*")
        .eq("razorpay_order_id", payload.razorpay_order_id)
        .execute()
    )
    if not order_row.data:
        raise HTTPException(status_code=404, detail="Unknown order - it was not created by this server.")
    record = order_row.data[0]
    if record["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="This order does not belong to your account.")

    granted_tier = plan_for_amount(record.get("amount_inr"))
    is_pro = granted_tier == PRO_TIER_NAME

    if record.get("status") == "captured":
        # Already processed (e.g. webhook got there first) - idempotent success.
        return {
            "success": True,
            "message": "Payment already verified. Your plan is active.",
            "subscription_tier": granted_tier,
            "is_subscribed": True,
            "expires_at": record.get("premium_expires_at"),
        }

    try:
        rp_payment = client.payment.fetch(payload.razorpay_payment_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not confirm payment with Razorpay: {exc}")

    if rp_payment.get("status") != "captured":
        supabase.table("payments").update({
            "status": rp_payment.get("status", "unknown"),
            "razorpay_payment_id": payload.razorpay_payment_id,
        }).eq("razorpay_order_id", payload.razorpay_order_id).execute()
        raise HTTPException(
            status_code=402,
            detail=f"Payment not completed yet (Razorpay status: {rp_payment.get('status')}).",
        )

    expires_at = datetime.now(timezone.utc) + timedelta(days=PAID_DURATION_DAYS)

    supabase.table("payments").update({
        "status": "captured",
        "razorpay_payment_id": payload.razorpay_payment_id,
        "razorpay_signature": payload.razorpay_signature,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "premium_expires_at": expires_at.isoformat(),
    }).eq("razorpay_order_id", payload.razorpay_order_id).execute()

    supabase.table("users").update({
        "subscription_tier": granted_tier,
        "subscription_expires_at": expires_at.isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", current_user["id"]).execute()

    plan_label = "Pro" if is_pro else "Normal"
    return {
        "success": True,
        "message": f"Payment verified! {plan_label} is active until {expires_at.strftime('%d %b %Y')}.",
        "subscription_tier": granted_tier,
        "is_subscribed": True,
        "expires_at": expires_at.isoformat(),
        "unlocked_features": {
            "custom_stories_per_month": 8 if is_pro else 3,
            "voice_clones_per_month": 4 if is_pro else 0,
            "unlimited_library_access": True,
            "unlimited_children_profiles": True,
            "hd_soundscapes": True,
        },
    }


@router.post("/webhook")
async def razorpay_webhook(request: Request):
    """
    Server-to-server confirmation from Razorpay. This is the durable source
    of truth: it fires even if the parent closes the app right after paying,
    before /verify-payment ever runs on the client. Configure this URL
    (https://<your-deployed-backend>/api/subscriptions/webhook) under
    Razorpay Dashboard -> Settings -> Webhooks once the backend is deployed,
    and put the webhook secret it gives you into RAZORPAY_WEBHOOK_SECRET.
    Razorpay cannot reach a localhost URL, so this only fires in a real
    deployment (or through a tunnel like ngrok during testing).
    """
    body = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")

    if not settings.RAZORPAY_WEBHOOK_SECRET:
        # Webhook not set up yet - accept the ping without acting on it
        # rather than 500ing, so Razorpay doesn't keep retrying forever.
        return {"status": "ignored", "reason": "RAZORPAY_WEBHOOK_SECRET not configured yet"}

    try:
        razorpay.Utility().verify_webhook_signature(
            body.decode("utf-8"), signature, settings.RAZORPAY_WEBHOOK_SECRET
        )
    except SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid webhook signature.")

    payload = json.loads(body)
    event = payload.get("event")
    supabase = get_supabase()

    if event == "payment.captured":
        entity = payload.get("payload", {}).get("payment", {}).get("entity", {})
        order_id = entity.get("order_id")
        payment_id = entity.get("id")
        if order_id:
            row = supabase.table("payments").select("*").eq("razorpay_order_id", order_id).execute()
            if row.data and row.data[0].get("status") != "captured":
                record = row.data[0]
                granted_tier = plan_for_amount(record.get("amount_inr"))
                expires_at = datetime.now(timezone.utc) + timedelta(days=PAID_DURATION_DAYS)
                supabase.table("payments").update({
                    "status": "captured",
                    "razorpay_payment_id": payment_id,
                    "captured_at": datetime.now(timezone.utc).isoformat(),
                    "premium_expires_at": expires_at.isoformat(),
                }).eq("razorpay_order_id", order_id).execute()
                supabase.table("users").update({
                    "subscription_tier": granted_tier,
                    "subscription_expires_at": expires_at.isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", record["user_id"]).execute()

    elif event == "payment.failed":
        entity = payload.get("payload", {}).get("payment", {}).get("entity", {})
        order_id = entity.get("order_id")
        if order_id:
            supabase.table("payments").update({"status": "failed"}).eq("razorpay_order_id", order_id).execute()

    elif event == "subscription.charged":
        # A monthly auto-renew charge went through: push the plan forward.
        sub_entity = payload.get("payload", {}).get("subscription", {}).get("entity", {})
        pay_entity = payload.get("payload", {}).get("payment", {}).get("entity", {})
        sub_id = sub_entity.get("id")
        if sub_id and pay_entity.get("status") in (None, "captured"):
            try:
                _grant_from_subscription(get_razorpay_client(), supabase, sub_id, pay_entity)
            except Exception as exc:
                # Non-2xx makes Razorpay retry the webhook later.
                raise HTTPException(status_code=500, detail=f"Could not apply subscription charge: {exc}")

    elif event in (
        "subscription.authenticated", "subscription.activated", "subscription.pending",
        "subscription.halted", "subscription.cancelled", "subscription.completed",
        "subscription.paused", "subscription.resumed",
    ):
        # Keep our copy of the subscription status in sync. Access itself is
        # never revoked here - it just stops being extended, and lapses at
        # subscription_expires_at.
        sub_entity = payload.get("payload", {}).get("subscription", {}).get("entity", {})
        sub_id = sub_entity.get("id")
        status_map = {
            "subscription.authenticated": "authenticated",
            "subscription.activated": "active",
            "subscription.resumed": "active",
            "subscription.pending": "pending",
            "subscription.halted": "halted",
            "subscription.cancelled": "cancelled",
            "subscription.completed": "completed",
            "subscription.paused": "paused",
        }
        if sub_id:
            existing = (
                supabase.table("autopay_subscriptions")
                .select("status")
                .eq("razorpay_subscription_id", sub_id)
                .execute()
            )
            new_status = status_map[event]
            # keep "cancelling" (cancel at cycle end requested) until it truly ends
            if existing.data and not (existing.data[0].get("status") == "cancelling" and new_status == "active"):
                supabase.table("autopay_subscriptions").update({
                    "status": new_status,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }).eq("razorpay_subscription_id", sub_id).execute()

    return {"status": "ok"}
