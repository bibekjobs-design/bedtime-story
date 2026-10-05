from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime, timezone, timedelta
import httpx

from app.config import settings
from app.db import get_supabase
from app.auth import get_current_user
from app.services.voice_clone_service import CLONED_VOICE_CHAR_LIMIT
from app.services.cost_constants import (
    ELEVENLABS_PLAN_CHAR_LIMIT_MONTHLY,
    ELEVENLABS_PLAN_COST_USD,
    GOOGLE_TTS_FREE_CHAR_LIMIT_MONTHLY,
    GOOGLE_TTS_COST_PER_MILLION_CHARS_USD,
    USD_TO_INR,
)
from app.services import tts_usage_service
from app.services.category_image_service import generate_category_image

router = APIRouter(prefix="/api/admin", tags=["Admin"])


def _get_elevenlabs_live_usage():
    """
    Reads the REAL, authoritative character usage directly from ElevenLabs'
    own account (/v1/user/subscription) - character_count/character_limit for
    the current billing cycle. This is what actually gets billed, unlike our
    own DB estimate below (which pools every account that has ever tested
    cloned narration, plus historical full_text rows saved before the
    CLONED_VOICE_CHAR_LIMIT cap existed, and can look inflated as a
    result). Returns None if the key is missing or the call fails, so the
    dashboard can fall back to the DB-based estimate.
    """
    if not settings.ELEVENLABS_API_KEY:
        return None
    try:
        res = httpx.get(
            "https://api.elevenlabs.io/v1/user/subscription",
            headers={"xi-api-key": settings.ELEVENLABS_API_KEY},
            timeout=10.0,
        )
        if res.status_code != 200:
            return None
        data = res.json()
        return {
            "character_count": data.get("character_count"),
            "character_limit": data.get("character_limit"),
            "tier": data.get("tier"),
            "next_reset_unix": data.get("next_character_count_reset_unix"),
        }
    except Exception:
        return None

# --- Cost-planning constants ---
# Moved to app/services/cost_constants.py (single source of truth, shared
# with tts_usage_service.py's live quota tracker) - imported above.
# Treat the dashboard's warnings as directional ("you're trending toward a
# limit"), not as an exact invoice forecast.


def _trend_counts(timestamps, now, window_days=7):
    """
    Splits a list of datetimes into 'this window' (last N days) and 'prior
    window' (the N days before that), so growth can be measured instead of
    just a single snapshot count.
    """
    last_start = now - timedelta(days=window_days)
    prior_start = now - timedelta(days=window_days * 2)
    last_count = sum(1 for t in timestamps if last_start <= t <= now)
    prior_count = sum(1 for t in timestamps if prior_start <= t < last_start)
    return last_count, prior_count


def _growth_pct(last_count: int, prior_count: int):
    if prior_count > 0:
        return round(((last_count - prior_count) / prior_count) * 100, 1)
    return 100.0 if last_count > 0 else 0.0


def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """
    Gate for every admin-only endpoint. current_user["is_admin"] is set by
    apply_admin_overrides() in app/auth.py for the hardcoded admin email(s) -
    same check already used to unlock voice cloning etc. for admin/test
    accounts, so admin status here always matches what the rest of the app
    already treats as "admin".
    """
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access only.")
    return current_user


@router.get("/dashboard")
def get_admin_dashboard(current_user: dict = Depends(require_admin)):
    """
    Aggregate stats for the admin dashboard: users/subscriptions, content
    generated, voice cloning usage, and revenue. Built from direct counts/
    sums against Supabase - fine at this app's current scale; if the tables
    grow large this should move to a scheduled rollup instead of live counts.
    """
    supabase = get_supabase()
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=7)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    def count(table: str, filters=None) -> int:
        q = supabase.table(table).select("id", count="exact")
        for col, op, val in (filters or []):
            q = getattr(q, op)(col, val)
        res = q.execute()
        return res.count or 0

    # --- Users & subscriptions ---
    all_users = supabase.table("users").select("subscription_tier, created_at").execute().data or []
    total_users = len(all_users)
    tier_counts = {}
    signups_today = 0
    signups_week = 0
    user_signup_times = []
    for u in all_users:
        tier = u.get("subscription_tier") or "free"
        tier_counts[tier] = tier_counts.get(tier, 0) + 1
        created_at = u.get("created_at")
        if created_at:
            try:
                created_dt = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
                user_signup_times.append(created_dt)
                if created_dt >= today_start:
                    signups_today += 1
                if created_dt >= week_start:
                    signups_week += 1
            except (ValueError, TypeError):
                pass

    premium_tiers = ("premium", "premium_monthly", "premium_annual", "pro_monthly")  # Pro (Rs 151) + Super (Rs 219) plans
    normal_tiers = ("normal_monthly",)  # "Normal" plan
    premium_users = sum(tier_counts.get(t, 0) for t in premium_tiers)
    normal_users = sum(tier_counts.get(t, 0) for t in normal_tiers)

    # --- Child profiles ---
    total_profiles = count("child_profiles")

    # --- Voice clones ---
    all_clones = supabase.table("voice_clones").select("provider_voice_id").execute().data or []
    total_clones = len(all_clones)
    real_clones = sum(1 for c in all_clones if not (c.get("provider_voice_id") or "").startswith("simulated_"))

    # --- Stories generated (personalized_stories: file-upload + cloned narrations) ---
    # full_text is pulled only to measure narrated-character volume (the actual
    # cost driver for ElevenLabs/Google TTS) - never returned to the client.
    all_personalized = (
        supabase.table("personalized_stories").select("voice_tier, created_at, full_text").execute().data or []
    )
    total_personalized = len(all_personalized)
    cloned_narrations = sum(1 for p in all_personalized if p.get("voice_tier") == "deluxe")
    ai_narrations = total_personalized - cloned_narrations
    generated_today = 0
    generated_week = 0
    cloned_story_times = []
    ai_story_times = []
    cloned_chars_last7 = 0
    ai_chars_last7 = 0
    cloned_chars_mtd = 0
    ai_chars_mtd = 0
    cloned_chars_alltime = 0
    ai_chars_alltime = 0
    last7_start = now - timedelta(days=7)
    for p in all_personalized:
        created_at = p.get("created_at")
        is_cloned = p.get("voice_tier") == "deluxe"
        char_len = len(p.get("full_text") or "")
        # All-time actual usage counts every row regardless of whether its
        # timestamp parses cleanly, so it never undercounts real narration
        # that happened.
        if is_cloned:
            cloned_chars_alltime += char_len
        else:
            ai_chars_alltime += char_len
        if created_at:
            try:
                created_dt = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
                if created_dt >= today_start:
                    generated_today += 1
                if created_dt >= week_start:
                    generated_week += 1
                if is_cloned:
                    cloned_story_times.append(created_dt)
                else:
                    ai_story_times.append(created_dt)
                if created_dt >= last7_start:
                    if is_cloned:
                        cloned_chars_last7 += char_len
                    else:
                        ai_chars_last7 += char_len
                if created_dt >= month_start:
                    if is_cloned:
                        cloned_chars_mtd += char_len
                    else:
                        ai_chars_mtd += char_len
            except (ValueError, TypeError):
                pass

    # --- Library (pre-created) stories ---
    total_library_stories = count("story_texts")

    # --- Revenue (captured payments only) ---
    captured_payments = (
        supabase.table("payments").select("amount_inr, captured_at").eq("status", "captured").execute().data or []
    )
    total_revenue_inr = sum(p.get("amount_inr") or 0 for p in captured_payments)
    revenue_this_month_inr = 0
    for p in captured_payments:
        captured_at = p.get("captured_at")
        if captured_at:
            try:
                captured_dt = datetime.fromisoformat(str(captured_at).replace("Z", "+00:00"))
                if captured_dt >= month_start:
                    revenue_this_month_inr += p.get("amount_inr") or 0
            except (ValueError, TypeError):
                pass

    # --- Cost & capacity forecast ---
    # Projects the last 7 days of activity forward to a 30-day figure - a
    # simple, honest extrapolation (not compounding growth %, which would
    # overstate a short hot streak). Growth % is reported alongside as
    # context, not baked into the projection itself.
    signups_last7, signups_prior7 = _trend_counts(user_signup_times, now)
    user_growth_pct = _growth_pct(signups_last7, signups_prior7)
    projected_new_users_30d = round(signups_last7 * (30 / 7))

    cloned_last7, cloned_prior7 = _trend_counts(cloned_story_times, now)
    ai_last7, ai_prior7 = _trend_counts(ai_story_times, now)
    story_growth_pct = _growth_pct(cloned_last7 + ai_last7, cloned_prior7 + ai_prior7)

    projected_cloned_chars_30d = round(cloned_chars_last7 * (30 / 7))
    projected_ai_chars_30d = round(ai_chars_last7 * (30 / 7))

    def _capacity_status(projected: int, limit: int):
        if limit <= 0:
            return "ok"
        ratio = projected / limit
        if ratio >= 1.0:
            return "critical"
        if ratio >= 0.7:
            return "warning"
        return "ok"

    # --- Live ElevenLabs usage (authoritative) ---
    # Our own DB estimate (cloned_chars_mtd, above) pools full_text length
    # across EVERY account that has ever tested cloned narration, including
    # rows saved before CLONED_VOICE_CHAR_LIMIT existed, so it can look
    # much higher than what ElevenLabs actually billed. Ask ElevenLabs
    # directly for the real number and prefer it whenever the call succeeds.
    elevenlabs_live = _get_elevenlabs_live_usage()
    if elevenlabs_live and elevenlabs_live.get("character_count") is not None:
        elevenlabs_actual_chars = elevenlabs_live["character_count"]
        elevenlabs_actual_limit = elevenlabs_live.get("character_limit") or ELEVENLABS_PLAN_CHAR_LIMIT_MONTHLY
        elevenlabs_actual_source = "elevenlabs_live"
    else:
        elevenlabs_actual_chars = cloned_chars_mtd
        elevenlabs_actual_limit = ELEVENLABS_PLAN_CHAR_LIMIT_MONTHLY
        elevenlabs_actual_source = "app_db_estimate"

    elevenlabs_status = _capacity_status(elevenlabs_actual_chars, elevenlabs_actual_limit)
    google_tts_status = _capacity_status(projected_ai_chars_30d, GOOGLE_TTS_FREE_CHAR_LIMIT_MONTHLY)

    google_tts_overage_chars = max(0, projected_ai_chars_30d - GOOGLE_TTS_FREE_CHAR_LIMIT_MONTHLY)
    google_tts_est_cost_usd = round((google_tts_overage_chars / 1_000_000) * GOOGLE_TTS_COST_PER_MILLION_CHARS_USD, 2)
    google_tts_est_cost_inr = round(google_tts_est_cost_usd * USD_TO_INR)

    warnings = []
    if elevenlabs_status != "ok":
        source_note = (
            "per ElevenLabs' own account data"
            if elevenlabs_actual_source == "elevenlabs_live"
            else "estimated from in-app records - re-check against elevenlabs.io if this looks off"
        )
        warnings.append({
            "severity": elevenlabs_status,
            "service": "ElevenLabs (cloned voice narration)",
            "message": (
                f"You've actually used {elevenlabs_actual_chars:,} of your {elevenlabs_actual_limit:,} "
                f"characters this billing cycle ({source_note}). "
                + ("You've hit the limit - upgrade the plan or wait for the monthly reset before cloning more."
                   if elevenlabs_status == "critical"
                   else "You're approaching the limit - keep an eye on it.")
            ),
        })
    if google_tts_status != "ok":
        warnings.append({
            "severity": google_tts_status,
            "service": "Google Cloud TTS (AI voice narration)",
            "message": (
                f"At the last 7 days' pace, AI-voice narration would use ~{projected_ai_chars_30d:,} characters "
                f"over 30 days, vs the {GOOGLE_TTS_FREE_CHAR_LIMIT_MONTHLY:,}/month free tier. "
                + (f"Estimated overage cost: ~${google_tts_est_cost_usd}/mo (~₹{google_tts_est_cost_inr}/mo)."
                   if google_tts_status == "critical"
                   else "You're approaching the free tier limit - budget for overage soon.")
            ),
        })
    if user_growth_pct >= 50 and signups_last7 >= 3:
        warnings.append({
            "severity": "info",
            "service": "User growth",
            "message": (
                f"Signups are up {user_growth_pct}% week-over-week ({signups_last7} vs {signups_prior7}). "
                f"At this pace, expect roughly {projected_new_users_30d} new users over the next 30 days - "
                "narration and hosting costs scale with active users, not just signups, but this is an early signal to plan capacity."
            ),
        })
    if CLONED_VOICE_CHAR_LIMIT:
        # 4 Pro-plan clones/month x CLONED_VOICE_CHAR_LIMIT chars = the real
        # per-active-Pro-subscriber ElevenLabs cost. Worth surfacing here
        # since it's what actually determines how many Pro subscribers the
        # current ElevenLabs plan can support before hitting its cap.
        chars_per_pro_user_month = CLONED_VOICE_CHAR_LIMIT * 4
        max_active_pro_users = (
            elevenlabs_actual_limit // chars_per_pro_user_month if chars_per_pro_user_month else None
        )
        warnings.append({
            "severity": "info",
            "service": "Cloned voice capacity (Pro plan)",
            "message": (
                f"Each Pro subscriber can use up to 4 cloned-voice narrations/month at "
                f"{CLONED_VOICE_CHAR_LIMIT} characters each (~{chars_per_pro_user_month:,} chars/user/month). "
                f"At the current ElevenLabs plan limit ({elevenlabs_actual_limit:,} chars/month), that's roughly "
                f"{max_active_pro_users} fully-active Pro subscribers before you'd need to upgrade the ElevenLabs plan."
            ),
        })

    return {
        "generated_at": now.isoformat(),
        "capacity_forecast": {
            "users": {
                "signups_last_7_days": signups_last7,
                "signups_prior_7_days": signups_prior7,
                "growth_pct_week_over_week": user_growth_pct,
                "projected_new_users_next_30_days": projected_new_users_30d,
            },
            "stories": {
                "growth_pct_week_over_week": story_growth_pct,
            },
            "elevenlabs": {
                "status": elevenlabs_status,
                # "actual_chars"/"actual_limit" are the REAL numbers - pulled
                # live from ElevenLabs' own account when the API call succeeds
                # (actual_source == "elevenlabs_live"), otherwise falling back
                # to our own in-app estimate ("app_db_estimate"), which pools
                # every account that has ever tested cloned narration and can
                # read much higher than what was really billed.
                "actual_chars": elevenlabs_actual_chars,
                "actual_limit": elevenlabs_actual_limit,
                "actual_source": elevenlabs_actual_source,
                "used_pct_this_month": (
                    round((elevenlabs_actual_chars / elevenlabs_actual_limit) * 100, 1)
                    if elevenlabs_actual_limit else 0
                ),
                # In-app record breakdown (all accounts, for reference only -
                # see the note above on why this can look inflated).
                "app_db_chars_last_7_days": cloned_chars_last7,
                "app_db_chars_this_month": cloned_chars_mtd,
                "app_db_chars_all_time": cloned_chars_alltime,
                "projected_chars_next_30_days": projected_cloned_chars_30d,
                "plan_limit_monthly": ELEVENLABS_PLAN_CHAR_LIMIT_MONTHLY,
                "plan_cost_usd": ELEVENLABS_PLAN_COST_USD,
            },
            "google_tts": {
                "status": google_tts_status,
                "chars_last_7_days": ai_chars_last7,
                "chars_this_month": ai_chars_mtd,
                "chars_all_time": ai_chars_alltime,
                "used_pct_this_month": (
                    round((ai_chars_mtd / GOOGLE_TTS_FREE_CHAR_LIMIT_MONTHLY) * 100, 1)
                    if GOOGLE_TTS_FREE_CHAR_LIMIT_MONTHLY else 0
                ),
                "projected_chars_next_30_days": projected_ai_chars_30d,
                "free_limit_monthly": GOOGLE_TTS_FREE_CHAR_LIMIT_MONTHLY,
                "estimated_overage_cost_usd": google_tts_est_cost_usd,
                "estimated_overage_cost_inr": google_tts_est_cost_inr,
                # LIVE, authoritative counter - fed directly from every real
                # synthesize_story_audio() call across Library + Create +
                # Personalize, unlike the estimate above (which only reads
                # personalized_stories rows). This is what actually drives
                # the free-tier cost guard and the 70/90/100% admin alerts.
                "live_tracker": tts_usage_service.get_usage_summary(),
            },
            "warnings": warnings,
        },
        "users": {
            "total": total_users,
            "premium": premium_users,
            "pro": premium_users,
            "normal": normal_users,
            "free": tier_counts.get("free", 0),
            "by_tier": tier_counts,
            "signups_today": signups_today,
            "signups_this_week": signups_week,
        },
        "profiles": {
            "total_child_profiles": total_profiles,
        },
        "voice_clones": {
            "total": total_clones,
            "real_registered": real_clones,
            "still_simulated": total_clones - real_clones,
        },
        "stories": {
            "library_stories": total_library_stories,
            "personalized_total": total_personalized,
            "cloned_narrations": cloned_narrations,
            "ai_voice_narrations": ai_narrations,
            "generated_today": generated_today,
            "generated_this_week": generated_week,
        },
        "revenue": {
            "total_inr": total_revenue_inr,
            "this_month_inr": revenue_this_month_inr,
            "total_captured_payments": len(captured_payments),
        },
        # Live Postgres DB size + Supabase Storage bucket sizes against the
        # free-plan limits (500MB DB / 1GB storage) - see
        # _get_db_storage_stats() and backend/sql/003_db_storage_stats_function.sql.
        # Does NOT include egress/bandwidth - check that on Supabase's own
        # dashboard Usage page.
        "db_storage": _get_db_storage_stats(),
    }


# --- Month-wise subscribed vs free report ---
# Test/dummy accounts created during development (@example.com) never paid
# real money and would skew every count and revenue figure below, so this
# whole report excludes them - it's meant to answer "how many REAL users
# were actually paying vs free in a given month", not "how many rows exist".
TEST_EMAIL_SUFFIX = "@example.com"


def _is_real_account(email: str) -> bool:
    return bool(email) and not email.lower().strip().endswith(TEST_EMAIL_SUFFIX)


def _month_bounds(month_str: str):
    """'2026-09' -> (start_of_month, start_of_next_month), both UTC datetimes."""
    year, month = (int(x) for x in month_str.split("-"))
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year + 1, 1, 1, tzinfo=timezone.utc) if month == 12 else datetime(year, month + 1, 1, tzinfo=timezone.utc)
    return start, end


def _parse_dt(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


@router.get("/monthly-report")
def get_monthly_report(month: str = None, current_user: dict = Depends(require_admin)):
    """
    For a given calendar month ('YYYY-MM', defaults to the current month),
    returns which REAL users (test @example.com accounts excluded) were
    actually subscribed vs free during that month, and revenue collected in
    that month.

    "Subscribed in month M" is derived from the payments table's own paid
    coverage window (captured_at -> premium_expires_at) overlapping month M -
    NOT from the user's current subscription_tier column. The tier column
    only reflects "today"; it gets silently corrected back to "free" by
    get_current_user() the next time that user makes an API call after their
    subscription lapses, so a user who paid in June but hasn't opened the
    app since could still show as "premium" in the users table well into
    September. Deriving status from actual payment history instead makes
    this report correct for ANY past month, regardless of what the live
    tier column happens to say right now.
    """
    supabase = get_supabase()
    now = datetime.now(timezone.utc)

    all_users = (
        supabase.table("users").select("id, email, full_name, subscription_tier, created_at").execute().data or []
    )
    real_users = [u for u in all_users if _is_real_account(u.get("email"))]
    user_by_id = {u["id"]: u for u in real_users}

    # Every real user's created_at, to find the earliest signup for the
    # month picker, and to know when each user "existed" from.
    signup_times = {u["id"]: _parse_dt(u.get("created_at")) for u in real_users}
    valid_signups = [t for t in signup_times.values() if t]
    earliest_signup = min(valid_signups) if valid_signups else now

    # Build the list of selectable months: every calendar month from the
    # earliest real signup through the current month.
    available_months = []
    cursor_year, cursor_month = earliest_signup.year, earliest_signup.month
    while (cursor_year, cursor_month) <= (now.year, now.month):
        available_months.append(f"{cursor_year}-{cursor_month:02d}")
        if cursor_month == 12:
            cursor_year, cursor_month = cursor_year + 1, 1
        else:
            cursor_month += 1

    month_str = month or f"{now.year}-{now.month:02d}"
    if month_str not in available_months:
        # Still allow it (e.g. a month with no signups yet but with payments
        # somehow) rather than hard-erroring - just compute it as asked.
        available_months = sorted(set(available_months) | {month_str})
    month_start, month_end = _month_bounds(month_str)

    # All captured payments from real users, with their paid coverage window.
    all_payments = (
        supabase.table("payments")
        .select("user_id, amount_inr, captured_at, premium_expires_at, status")
        .eq("status", "captured")
        .execute()
        .data
        or []
    )
    real_payments = [p for p in all_payments if p.get("user_id") in user_by_id]

    revenue_this_month = 0
    subscribed_ids_this_month = set()
    subscribed_details = {}
    for p in real_payments:
        captured_dt = _parse_dt(p.get("captured_at"))
        expires_dt = _parse_dt(p.get("premium_expires_at")) or captured_dt
        if not captured_dt:
            continue
        if month_start <= captured_dt < month_end:
            revenue_this_month += p.get("amount_inr") or 0
        # "Subscribed during month M" = paid coverage window overlaps month M at all.
        if expires_dt and captured_dt < month_end and expires_dt >= month_start:
            uid = p.get("user_id")
            subscribed_ids_this_month.add(uid)
            entry = subscribed_details.setdefault(uid, {"paid_amount_inr": 0, "windows": []})
            entry["paid_amount_inr"] += p.get("amount_inr") or 0
            entry["windows"].append({
                "captured_at": p.get("captured_at"),
                "expires_at": p.get("premium_expires_at"),
            })

    subscribed_users = []
    for uid in subscribed_ids_this_month:
        u = user_by_id.get(uid)
        if not u:
            continue
        subscribed_users.append({
            "id": uid,
            "email": u.get("email"),
            "full_name": u.get("full_name"),
            "paid_amount_inr_this_month_windows": subscribed_details[uid]["paid_amount_inr"],
            "coverage_windows": subscribed_details[uid]["windows"],
        })
    subscribed_users.sort(key=lambda x: (x.get("email") or ""))

    free_users = []
    for u in real_users:
        uid = u["id"]
        if uid in subscribed_ids_this_month:
            continue
        signed_up = signup_times.get(uid)
        # Only count a user as "free during month M" if they'd actually
        # signed up by the end of that month - someone who joined in
        # October shouldn't appear as a "free user" in September's report.
        if signed_up and signed_up < month_end:
            free_users.append({
                "id": uid,
                "email": u.get("email"),
                "full_name": u.get("full_name"),
                "signed_up_at": u.get("created_at"),
            })
    free_users.sort(key=lambda x: (x.get("email") or ""))

    return {
        "month": month_str,
        "available_months": available_months,
        "generated_at": now.isoformat(),
        "excluded_test_accounts": len(all_users) - len(real_users),
        "revenue_inr_this_month": revenue_this_month,
        "subscribed_count": len(subscribed_users),
        "free_count": len(free_users),
        "subscribed_users": subscribed_users,
        "free_users": free_users,
    }


@router.get("/tts-usage")
def get_tts_usage(current_user: dict = Depends(require_admin)):
    """
    Lightweight, standalone version of the dashboard's live Google TTS
    tracker - characters used this month against the shared 1,000,000-char
    free quota, current %, and whether the 70/90/100% alerts have already
    fired this month. Meant for a small always-visible admin banner so you
    don't have to load the full /dashboard payload just to check this.
    """
    return tts_usage_service.get_usage_summary()


# Supabase FREE PLAN limits (as of when this was built, Sep 2026) - re-verify
# on Supabase's pricing page if you're on a different plan or they change.
SUPABASE_FREE_DB_LIMIT_BYTES = 500 * 1024 * 1024        # 500 MB
SUPABASE_FREE_STORAGE_LIMIT_BYTES = 1 * 1024 * 1024 * 1024   # 1 GB


@router.get("/db-storage-usage")
def get_db_storage_usage(current_user: dict = Depends(require_admin)):
    """
    Standalone endpoint version - see _get_db_storage_stats() for the actual
    logic (also embedded live in GET /dashboard under "db_storage").
    """
    return _get_db_storage_stats()


def _get_db_storage_stats() -> dict:
    """
    Live Postgres database size + Supabase Storage bucket sizes, read via the
    admin_db_storage_stats() Postgres function (see
    backend/sql/003_db_storage_stats_function.sql - run that once in the
    Supabase SQL editor, or this returns an error note instead of numbers).

    NOTE: this does NOT include egress/bandwidth usage - Supabase doesn't
    expose that through a queryable table, only through the project's own
    Usage page in the Supabase dashboard (or the separate Management API,
    which needs a personal access token this app doesn't have configured).
    Egress is usually the first free-tier limit you'll actually hit in
    practice, since every story PLAY re-streams the full audio file - check
    it manually on Supabase's dashboard periodically.
    """
    try:
        supabase = get_supabase()
        res = supabase.rpc("admin_db_storage_stats").execute()
        rows = res.data or []
    except Exception as e:
        return {
            "error": (
                "Could not read DB/storage stats - has "
                "backend/sql/003_db_storage_stats_function.sql been run in "
                "the Supabase SQL editor yet?"
            ),
            "detail": str(e),
        }

    if not rows:
        return {
            "db_size_bytes": 0, "db_size_pretty": "0 B",
            "db_percent_of_free_limit": 0,
            "storage_total_bytes": 0, "storage_total_pretty": "0 B",
            "storage_percent_of_free_limit": 0,
            "buckets": [],
            "note": "No storage buckets found yet.",
        }

    db_size_bytes = rows[0].get("db_size_bytes", 0) or 0
    buckets = []
    storage_total_bytes = 0
    for r in rows:
        b_bytes = r.get("storage_bytes", 0) or 0
        storage_total_bytes += b_bytes
        buckets.append({
            "bucket_id": r.get("bucket_id"),
            "bytes": b_bytes,
            "pretty": _pretty_bytes(b_bytes),
            "file_count": r.get("file_count", 0),
        })
    buckets.sort(key=lambda b: b["bytes"], reverse=True)

    return {
        "db_size_bytes": db_size_bytes,
        "db_size_pretty": _pretty_bytes(db_size_bytes),
        "db_free_limit_pretty": _pretty_bytes(SUPABASE_FREE_DB_LIMIT_BYTES),
        "db_percent_of_free_limit": round((db_size_bytes / SUPABASE_FREE_DB_LIMIT_BYTES) * 100, 1),
        "storage_total_bytes": storage_total_bytes,
        "storage_total_pretty": _pretty_bytes(storage_total_bytes),
        "storage_free_limit_pretty": _pretty_bytes(SUPABASE_FREE_STORAGE_LIMIT_BYTES),
        "storage_percent_of_free_limit": round((storage_total_bytes / SUPABASE_FREE_STORAGE_LIMIT_BYTES) * 100, 1),
        "buckets": buckets,
        "note": "Egress/bandwidth is NOT included - check that manually on Supabase's dashboard Usage page.",
    }


def _pretty_bytes(n: int) -> str:
    n = n or 0
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


@router.get("/categories")
def list_categories_for_admin(current_user: dict = Depends(require_admin)):
    """
    All categories with their current image_url (or null if never
    generated yet) - powers the admin dashboard's "Category Images" section.
    """
    supabase = get_supabase()
    res = supabase.table("story_categories").select("*").order("name").execute()
    return res.data or []


class CreateCategoryRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=60)
    description: Optional[str] = Field(default="")
    icon_url: Optional[str] = Field(default=None, description="A single emoji shown until a cover image is generated")


@router.post("/categories")
def create_category(payload: CreateCategoryRequest, current_user: dict = Depends(require_admin)):
    """
    Lets an admin add a brand-new story category on the fly (e.g. from the
    "Generate story" category picker, when nothing existing fits). New
    categories are active immediately and show up everywhere categories are
    listed - no image is generated here, that's a separate admin action.
    """
    supabase = get_supabase()
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Category name is required.")

    existing = supabase.table("story_categories").select("id").ilike("name", name).execute()
    if existing.data:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f'A category named "{name}" already exists.')

    ins_res = supabase.table("story_categories").insert({
        "name": name,
        "description": (payload.description or "").strip(),
        "icon_url": (payload.icon_url or "").strip() or None,
        "is_active": True,
    }).execute()
    if not ins_res.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create category.")
    return ins_res.data[0]


@router.post("/categories/{category_id}/generate-image")
def generate_category_image_endpoint(category_id: str, current_user: dict = Depends(require_admin)):
    """
    One-time (or re-run to replace) AI-generated cover picture for a
    category. Admin-triggered only - regular users never cause this to run,
    they only ever see the already-stored image_url.
    """
    supabase = get_supabase()
    cat_res = supabase.table("story_categories").select("*").eq("id", category_id).single().execute()
    if not cat_res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found.")

    category = cat_res.data
    try:
        image_url = generate_category_image(
            category_id=category_id,
            category_name=category.get("name", "Bedtime"),
            category_description=category.get("description", "") or "",
        )
        return {"category_id": category_id, "image_url": image_url}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Image generation failed: {str(exc)}",
        )
