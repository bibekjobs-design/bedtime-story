from datetime import datetime, timezone
from app.db import get_supabase

# Monthly limits per subscription tier
TIER_LIMITS = {
    # "free" = trial ACTIVE (new signups: 15 days; grandfathered existing
    # users: 30 days - see app/services/subscription_policy.py). 3 stories,
    # same story count as the paid Normal plan but differentiated by price
    # and by being a one-time trial window rather than a recurring monthly
    # allowance. Each story capped ~3 min (see
    # story_service.FREE_TIER_TARGET_WORDS), same as Normal, and further
    # protected by tts_usage_service's free-quota cost guard so trial
    # signups can never push the platform over Google TTS's shared free
    # monthly character quota.
    "free":            {"new_story_generation": 1, "voice_clone_story": 0, "personalization": 1},
    # "free_expired" = trial has lapsed and the user never subscribed.
    # Create/generation is fully locked; the pre-made Library stays free
    # and unlimited to browse forever (Library endpoints don't check usage
    # at all, so this only affects Create/convert/personalize).
    "free_expired":    {"new_story_generation": 0, "voice_clone_story": 0, "personalization": 0},
    # Normal plan - Rs 99/month. LISTEN ONLY: the Library, but no story creation
    # and no voice cloning.
    "normal_monthly":  {"new_story_generation": 0, "voice_clone_story": 0, "personalization": 0},
    # Pro plan (Rs 161/month): LISTEN ONLY (whole Library) - creating stories is Super only.
    # (story_service.NORMAL_TIER_TARGET_WORDS). No voice cloning.
    "pro_monthly":     {"new_story_generation": 0, "voice_clone_story": 0, "personalization": 0},
    # Super plan (tier name premium_*) - Rs 219/month (shown as a discount off Rs 299). 8 file-generated
    # stories/month capped at ~5 minutes (see story_service.PRO_TIER_TARGET_WORDS),
    # plus 4 cloned-voice narrations/month capped per-narration at
    # CLONED_VOICE_CHAR_LIMIT chars (~3 min).
    "premium":         {"new_story_generation": 5, "voice_clone_story": 4, "personalization": 5},
    "premium_monthly": {"new_story_generation": 5, "voice_clone_story": 4, "personalization": 5},
    "premium_annual":  {"new_story_generation": 5, "voice_clone_story": 4, "personalization": 5},
    "admin":           {"new_story_generation": 999, "voice_clone_story": 999, "personalization": 999},
    "admin_vip":       {"new_story_generation": 999, "voice_clone_story": 999, "personalization": 999},
}

DB_USAGE_TYPE_MAP = {
    "new_story_generation": "personalization",
    "personalization": "personalization",
    "voice_clone_story": "voice_clone_story",
}


def get_current_period_month() -> str:
    """Returns the first day of the current month as a date string e.g. '2026-09-01'."""
    now = datetime.now(timezone.utc)
    return f"{now.year}-{now.month:02d}-01"


def get_monthly_usage(user_id: str) -> dict:
    """
    Returns the current month's usage counts for a user.
    Returns dict like: {"new_story_generation": 2, "voice_clone_story": 1, "personalization": 2}
    """
    supabase = get_supabase()
    period = get_current_period_month()

    res = (
        supabase.table("usage_tracking")
        .select("usage_type, count")
        .eq("user_id", user_id)
        .eq("period_month", period)
        .execute()
    )

    usage = {"new_story_generation": 0, "voice_clone_story": 0, "personalization": 0}
    for row in (res.data or []):
        t = row.get("usage_type")
        c = row.get("count", 0)
        if t == "personalization":
            usage["personalization"] = c
            usage["new_story_generation"] = c
        elif t in usage:
            usage[t] = c

    return usage


def check_and_increment_usage(user_id: str, subscription_tier: str, usage_type: str) -> bool:
    """
    Checks if the user is within their monthly limit for the given usage_type.
    If within limit, increments the count by 1 and returns True.
    If over limit, returns False (caller should raise 403).
    """
    if subscription_tier in ("admin", "admin_vip", "superadmin"):
        return True
    supabase = get_supabase()
    period = get_current_period_month()
    limit = TIER_LIMITS.get(subscription_tier, TIER_LIMITS["free"]).get(usage_type, 10)

    db_type = DB_USAGE_TYPE_MAP.get(usage_type, usage_type)

    # Fetch current count
    existing = (
        supabase.table("usage_tracking")
        .select("id, count")
        .eq("user_id", user_id)
        .eq("usage_type", db_type)
        .eq("period_month", period)
        .execute()
    )

    current_count = 0
    existing_id = None

    if existing.data:
        current_count = existing.data[0]["count"]
        existing_id = existing.data[0]["id"]

    # Enforce limit
    if current_count >= limit:
        return False

    # Increment or create usage record
    if existing_id:
        supabase.table("usage_tracking").update(
            {"count": current_count + 1}
        ).eq("id", existing_id).execute()
    else:
        supabase.table("usage_tracking").insert({
            "user_id": user_id,
            "usage_type": db_type,
            "period_month": period,
            "count": 1
        }).execute()

    return True
