"""
Shared pricing & trial policy - single source of truth so subscriptions.py
(/status, /create-order, /verify-payment, /webhook) and stories.py (the
actual generation-limit enforcement) can never drift apart.

Pricing model (effective from TRIAL_POLICY_CUTOVER):
  - New signups get a 15-day free trial (full "free" tier access - see
    usage_service.TIER_LIMITS["free"]). After it lapses, unpaid users drop
    to TIER_LIMITS["free_expired"] (0 custom stories, 0 clones) but can
    still browse the pre-made Library forever - the Library endpoints
    don't check any of this at all.
  - Users who signed up BEFORE the cutover keep their original 30-day
    trial (grandfathered - per explicit product decision), so nobody who
    was already mid-trial gets cut short by this change shipping.
  - Two paid plans once the trial ends:
      Normal  - Rs 99/month  - 3 stories/month, ~3 min each, no voice cloning
      Pro     - Rs 219/month (shown with a struck-through Rs 299 "was"
                price) - 8 stories/month at ~5 min each, + 4 cloned-voice
                narrations/month (each capped at CLONED_VOICE_CHAR_LIMIT
                characters, ~3 min)
  - Existing payers who were already on the old flat Rs 199/month plan are
    auto-migrated to Pro (tier name "premium_monthly"/"premium_annual" is
    unchanged, per explicit product decision - no re-selection needed).
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

# Anyone who signed up on/after this date gets the new 15-day trial.
# Anyone who signed up before it keeps the original 30-day trial.
TRIAL_POLICY_CUTOVER = datetime(2026, 9, 25, tzinfo=timezone.utc)

NEW_TRIAL_DURATION_DAYS = 15
LEGACY_TRIAL_DURATION_DAYS = 30

# One-time goodwill window (Oct 2026): EVERY account that existed before
# EXISTING_USERS_CUTOVER gets a trial that runs until EXISTING_USERS_TRIAL_END,
# no matter when it signed up. 2026-10-30 18:30 UTC = 2026-10-31 00:00 IST, so
# the Home screen counts 30 days left on Oct 1, 29 on Oct 2, ... 1 on Oct 30.
# Accounts created on/after EXISTING_USERS_CUTOVER (Oct 1, 8:00 PM IST) follow
# the normal rule: NEW_TRIAL_DURATION_DAYS (15) from their own signup date,
# counting down day by day.
EXISTING_USERS_CUTOVER = datetime(2026, 10, 1, 14, 30, tzinfo=timezone.utc)  # Oct 1, 8:00 PM IST
EXISTING_USERS_TRIAL_END = datetime(2026, 10, 30, 18, 30, tzinfo=timezone.utc)

# Plan pricing (INR)
NORMAL_PLAN_PRICE_INR = 99
PRO_PLAN_PRICE_INR = 219
PRO_PLAN_ORIGINAL_PRICE_INR = 299  # shown struck-through next to the Rs 219 "discount" price

# Tier names granted on payment, keyed by which plan was purchased.
NORMAL_TIER_NAME = "normal_monthly"
PRO_TIER_NAME = "premium_monthly"  # unchanged from the old single-plan tier name

PAID_DURATION_DAYS = 30

# Tiers that count as "Pro" (full story quota + voice cloning).
PRO_TIERS = ("premium", "premium_monthly", "premium_annual", "admin", "admin_vip")
# Tiers that count as "Normal" (paid, but no cloning).
NORMAL_TIERS = ("normal_monthly",)
# Any tier that represents an active paid subscription of either kind.
PAID_TIERS = PRO_TIERS + NORMAL_TIERS


def _parse_dt(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def get_trial_duration_days(created_at) -> int:
    """Grandfathering rule: accounts created before the cutover keep 30
    days; accounts created on/after it get the new 15-day trial."""
    created_dt = _parse_dt(created_at)
    if created_dt is None:
        # Unknown signup date - be generous, not punitive.
        return LEGACY_TRIAL_DURATION_DAYS
    if created_dt < TRIAL_POLICY_CUTOVER:
        return LEGACY_TRIAL_DURATION_DAYS
    return NEW_TRIAL_DURATION_DAYS


def get_trial_info(created_at) -> dict:
    """
    Returns {"is_trial_active", "trial_ends_at", "hours_left", "days_left",
    "trial_duration_days"} for a "free" tier user (tier already downgraded
    from any expired paid plan by app/auth.py before this is called).
    """
    created_dt = _parse_dt(created_at)

    if created_dt is None or created_dt < EXISTING_USERS_CUTOVER:
        # Existing account (or no signup date on record - be generous, not
        # punitive): everyone shares the same goodwill trial end date.
        duration_days = LEGACY_TRIAL_DURATION_DAYS
        trial_end_dt = EXISTING_USERS_TRIAL_END
    else:
        duration_days = get_trial_duration_days(created_at)
        trial_end_dt = created_dt + timedelta(days=duration_days)
    now_dt = datetime.now(timezone.utc)
    is_active = now_dt < trial_end_dt

    hours_left = 0
    days_left = 0
    if is_active:
        remaining_seconds = (trial_end_dt - now_dt).total_seconds()
        hours_left = max(0, int(remaining_seconds // 3600))
        days_left = max(0, int(remaining_seconds // 86400) + (1 if remaining_seconds % 86400 > 0 else 0))

    return {
        "is_trial_active": is_active,
        "trial_ends_at": trial_end_dt.isoformat(),
        "hours_left": hours_left,
        "days_left": days_left,
        "trial_duration_days": duration_days,
    }


def is_trial_active(created_at) -> bool:
    return get_trial_info(created_at)["is_trial_active"]


def plan_for_amount(amount_inr) -> str:
    """Maps a captured payment's amount back to the tier it should grant.
    Defaults to Pro on an unrecognized amount so a payment never grants
    nothing - it's better to slightly over-grant than to take someone's
    money and give them no plan at all."""
    try:
        amount = int(round(float(amount_inr)))
    except (TypeError, ValueError):
        return PRO_TIER_NAME
    if amount == NORMAL_PLAN_PRICE_INR:
        return NORMAL_TIER_NAME
    return PRO_TIER_NAME
