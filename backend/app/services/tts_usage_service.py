"""
Live tracker for Google Cloud TTS character usage against the shared free
monthly quota (1,000,000 characters/month, platform-wide - see
cost_constants.GOOGLE_TTS_FREE_CHAR_LIMIT_MONTHLY).

Why this exists: the admin dashboard's existing "google_tts" section
*estimates* usage from personalized_stories rows, which misses Library
narrations (commit_and_narrate_story) and can drift from what Google
actually bills. This module is fed directly from every real
synthesize_story_audio() call (see tts_service.py), so it's the
authoritative, live number - and it's what powers two safety features:

  1. Free-trial cost guard: before narrating a Create/Narrator story for a
     "free" tier user, story_service.py calls would_exceed_free_quota() and
     blocks the request with a friendly message if it would push the whole
     platform over the free quota. Paid tiers are never blocked by this -
     their TTS cost is expected, revenue-covered usage.
  2. Admin alerts: record_tts_characters() fires an alert (dashboard flag +
     email, once per threshold per month) the first time usage crosses 70%,
     90%, then 100% of the free quota.

Everything here is best-effort and fails OPEN: any DB error is logged and
swallowed rather than raised, so a tracking hiccup can never block real
story narration, and would_exceed_free_quota() returns False (allow) on
error rather than locking out free users over an infra glitch.
"""
from datetime import datetime, timezone

from app.db import get_supabase
from app.services.cost_constants import (
    GOOGLE_TTS_FREE_CHAR_LIMIT_MONTHLY,
    GOOGLE_TTS_COST_PER_MILLION_CHARS_USD,
    USD_TO_INR,
)

TABLE = "tts_usage_monthly"

# (percent threshold, DB flag column, human label) - checked ascending so
# all newly-crossed flags get marked in one update even if usage jumps
# straight past an earlier threshold in a single request.
THRESHOLDS = [
    (70, "alert_70_sent", "🟡 70%"),
    (90, "alert_90_sent", "🟠 90%"),
    (100, "alert_100_sent", "🔴 100% (quota exceeded)"),
]


def _current_period_month() -> str:
    now = datetime.now(timezone.utc)
    return f"{now.year}-{now.month:02d}-01"


def _get_or_create_row(supabase, period: str) -> dict:
    res = supabase.table(TABLE).select("*").eq("period_month", period).execute()
    if res.data:
        return res.data[0]
    inserted = supabase.table(TABLE).insert({
        "period_month": period,
        "characters_used": 0,
    }).execute()
    if inserted.data:
        return inserted.data[0]
    return {
        "period_month": period, "characters_used": 0,
        "alert_70_sent": False, "alert_90_sent": False, "alert_100_sent": False,
    }


def get_usage_summary() -> dict:
    """Read-only snapshot for the admin dashboard. Never raises."""
    period = _current_period_month()
    try:
        supabase = get_supabase()
        row = _get_or_create_row(supabase, period)
        used = row.get("characters_used", 0) or 0
        limit = GOOGLE_TTS_FREE_CHAR_LIMIT_MONTHLY
        percent = round((used / limit) * 100, 1) if limit else 0.0
        overage_chars = max(0, used - limit)
        overage_cost_inr = round(
            (overage_chars / 1_000_000) * GOOGLE_TTS_COST_PER_MILLION_CHARS_USD * USD_TO_INR, 2
        )
        return {
            "period_month": period,
            "characters_used": used,
            "free_limit": limit,
            "percent_used": percent,
            "is_over_free_limit": used > limit,
            "overage_characters": overage_chars,
            "overage_cost_inr": overage_cost_inr,
            "alert_70_sent": bool(row.get("alert_70_sent")),
            "alert_90_sent": bool(row.get("alert_90_sent")),
            "alert_100_sent": bool(row.get("alert_100_sent")),
        }
    except Exception as e:
        print(f"[tts_usage_service.get_usage_summary] {e}")
        return {
            "period_month": period,
            "characters_used": 0,
            "free_limit": GOOGLE_TTS_FREE_CHAR_LIMIT_MONTHLY,
            "percent_used": 0.0,
            "is_over_free_limit": False,
            "overage_characters": 0,
            "overage_cost_inr": 0,
            "alert_70_sent": False,
            "alert_90_sent": False,
            "alert_100_sent": False,
            "error": "usage tracking unavailable - has backend/sql/002_tts_usage_monthly.sql been run in Supabase yet?",
        }


def would_exceed_free_quota(additional_chars: int) -> bool:
    """True if synthesizing `additional_chars` more this month would push the
    platform over the shared Google TTS free quota. Fails OPEN (returns
    False) on any error - this is a cost guard, not a hard gate, and a
    tracking glitch must never lock out a real user."""
    if not additional_chars or additional_chars <= 0:
        return False
    try:
        supabase = get_supabase()
        period = _current_period_month()
        row = _get_or_create_row(supabase, period)
        used = row.get("characters_used", 0) or 0
        return (used + additional_chars) > GOOGLE_TTS_FREE_CHAR_LIMIT_MONTHLY
    except Exception as e:
        print(f"[tts_usage_service.would_exceed_free_quota] {e}")
        return False


def record_tts_characters(char_count: int) -> None:
    """Best-effort: logs characters actually synthesized via Google Cloud TTS
    this month (call this once per synthesize_story_audio() call, regardless
    of subscription tier - it tracks the real, platform-wide Google usage).
    Fires an admin alert (dashboard flag, set here, + email) the first time
    usage crosses 70% / 90% / 100% of the shared free quota. Never raises."""
    if not char_count or char_count <= 0:
        return
    try:
        supabase = get_supabase()
        period = _current_period_month()
        row = _get_or_create_row(supabase, period)
        new_total = (row.get("characters_used", 0) or 0) + char_count
        limit = GOOGLE_TTS_FREE_CHAR_LIMIT_MONTHLY
        percent = (new_total / limit) * 100 if limit else 0.0

        update_fields = {
            "characters_used": new_total,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        newly_crossed = []
        for pct_threshold, flag, label in THRESHOLDS:
            if percent >= pct_threshold and not row.get(flag):
                update_fields[flag] = True
                newly_crossed.append((pct_threshold, label))

        supabase.table(TABLE).update(update_fields).eq("period_month", period).execute()

        if newly_crossed:
            highest_pct, highest_label = max(newly_crossed, key=lambda x: x[0])
            _send_threshold_alert(period, new_total, limit, percent, highest_label)
    except Exception as e:
        print(f"[tts_usage_service.record_tts_characters] {e}")


def _send_threshold_alert(period: str, used: int, limit: int, percent: float, label: str) -> None:
    try:
        from app.services.email_service import send_admin_alert_email
        per_char_inr = (GOOGLE_TTS_COST_PER_MILLION_CHARS_USD * USD_TO_INR) / 1_000_000
        send_admin_alert_email(
            subject=f"Bedtime Story - Google TTS free quota {label} - {period}",
            body=(
                f"Google Cloud TTS usage for {period}:\n\n"
                f"  {used:,} / {limit:,} characters used ({percent:.1f}% of the shared free monthly quota)\n\n"
                f"Beyond the free quota, Google bills ~Rs {per_char_inr:.5f} per character "
                f"(~Rs {GOOGLE_TTS_COST_PER_MILLION_CHARS_USD * USD_TO_INR:,.0f} per additional 1,000,000 characters).\n\n"
                f"Free-trial ('free' tier) story generation is automatically blocked once this would "
                f"push the platform over the free quota, so this alert is your notice to check the "
                f"admin dashboard and decide whether to raise prices, pause new signups, or accept the "
                f"overage for paid-tier usage."
            ),
        )
    except Exception as e:
        print(f"[tts_usage_service] alert email failed: {e}")
