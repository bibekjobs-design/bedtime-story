import secrets
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.config import settings
from app.db import get_supabase

# Password hashing using argon2 — modern, secure, no bcrypt Python 3.14 issues
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

# Bearer token extractor
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    """Hashes a plaintext password using bcrypt."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plaintext password against a stored hash."""
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(user_id: str, email: str, session_time: Optional[str] = None) -> str:
    """Creates a signed JWT access token valid for JWT_EXPIRE_MINUTES with session timestamp."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    session_ts = session_time or datetime.now(timezone.utc).isoformat()
    payload = {
        "sub": user_id,
        "email": email,
        "session_time": session_ts,
        "exp": expire,
        "iat": datetime.now(timezone.utc)
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    """Decodes and validates a JWT token. Returns payload or None."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except JWTError:
        return None


ADMIN_EMAILS = ["bibekjobs@gmail.com"]


def apply_admin_overrides(user: dict) -> dict:
    """
    Grants full premium access to hardcoded admin/test emails so they can
    test Premium-gated features (voice cloning, unlimited generation, etc.)
    without a real subscription. Mutates and returns the same dict so it can
    be used inline. Shared by get_current_user() and the /login response so
    an admin sees the correct tier immediately after signing in, not just on
    the next authenticated API call.
    """
    if (user.get("email") or "").lower() in ADMIN_EMAILS:
        user["subscription_tier"] = "premium_annual"
        user["is_admin"] = True
    return user


def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)) -> dict:
    """
    FastAPI dependency: extracts and validates the Bearer JWT token.
    Enforces single-device session: rejects tokens issued before the most recent login.
    Returns the authenticated user's record from Supabase.
    Raises 401 if token is missing, invalid, or superseded by a newer login on another device.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated. Please provide a Bearer token.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    payload = decode_access_token(credentials.credentials)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    supabase = get_supabase()
    user_res = (
        supabase.table("users")
        .select("id, full_name, email, mobile_number, subscription_tier, subscription_status, email_verified_at, marketing_opt_in, updated_at, subscription_expires_at, created_at")
        .eq("id", payload["sub"])
        .single()
        .execute()
    )

    if not user_res.data:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found.")

    user = user_res.data

    # A paid premium tier that has run past its subscription_expires_at is no
    # longer actually paid for - downgrade it here so every endpoint that
    # reads current_user["subscription_tier"] (usage limits, story gating,
    # etc.) sees the true state, not a stale "premium_monthly" forever.
    expires_at = user.get("subscription_expires_at")
    if expires_at and user.get("subscription_tier") in ("premium", "premium_monthly", "premium_annual", "normal_monthly"):
        try:
            expires_dt = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > expires_dt:
                supabase.table("users").update({"subscription_tier": "free"}).eq("id", user["id"]).execute()
                user["subscription_tier"] = "free"
        except (ValueError, TypeError):
            pass

    # Single-device session validation:
    token_session = payload.get("session_time")
    db_updated_at = user.get("updated_at")
    if token_session and db_updated_at:
        try:
            token_dt = datetime.fromisoformat(str(token_session).replace("Z", "+00:00"))
            db_dt = datetime.fromisoformat(str(db_updated_at).replace("Z", "+00:00"))
            # If DB was updated > 60 seconds after this token was issued, another device logged in
            if (db_dt - token_dt).total_seconds() > 60.0:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Session expired: Your account was logged in on another device. Please log in again.",
                    headers={"WWW-Authenticate": "Bearer"}
                )
        except (ValueError, TypeError):
            pass

    apply_admin_overrides(user)

    return user


def get_current_user_optional(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)) -> Optional[dict]:
    """
    Same as get_current_user, but returns None instead of raising 401 when
    there's no/invalid token. Used on public endpoints (Library browse,
    search, story commit) that stay usable while logged out, but need to
    know WHO is asking when the caller happens to be logged in - e.g. so an
    admin-only content-generation trigger can check `is_admin`, and a
    logged-in listener's play can be attributed to their account in the
    history log, without forcing a login wall on everyone else.
    """
    if not credentials:
        return None
    try:
        return get_current_user(credentials)
    except HTTPException:
        return None


def generate_secure_token() -> str:
    """Generates a secure random URL-safe token for email verification / password reset."""
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    """Creates a SHA-256 hash of a token for safe DB storage (never store raw tokens)."""
    return hashlib.sha256(token.encode()).hexdigest()
