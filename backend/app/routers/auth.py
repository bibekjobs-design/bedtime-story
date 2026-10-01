from fastapi import APIRouter, HTTPException, status, Depends, BackgroundTasks
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime, timedelta, timezone

from app.db import get_supabase
from app.auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, generate_secure_token, hash_token,
    apply_admin_overrides
)
from app.services.email_service import (
    send_verification_email, send_password_reset_email,
    send_password_changed_email, send_welcome_email
)

router = APIRouter(prefix="/api/auth", tags=["Auth"])


# --- Request / Response Models ---

class RegisterRequest(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=100)
    email: EmailStr
    mobile_number: str = Field(..., min_length=7, max_length=20)
    password: str = Field(..., min_length=8, description="Minimum 8 characters")
    confirm_password: str
    marketing_opt_in: bool = False


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(..., min_length=8)
    confirm_password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)
    confirm_password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


# --- Register ---
@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, background_tasks: BackgroundTasks):
    """
    Register a new user. Sends email verification.
    Marketing emails require explicit opt-in (separate from required transactional emails).
    """
    if payload.password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match.")

    supabase = get_supabase()

    # Check for duplicate email
    existing_email = supabase.table("users").select("id").eq("email", payload.email).execute()
    if existing_email.data:
        raise HTTPException(status_code=400, detail="An account with this email address already exists. Please log in.")

    # Check for duplicate mobile number
    existing_mobile = supabase.table("users").select("id").eq("mobile_number", payload.mobile_number).execute()
    if existing_mobile.data:
        raise HTTPException(status_code=400, detail="An account with this mobile number already exists. Please log in.")

    # Hash password and insert user
    pw_hash = hash_password(payload.password)
    try:
        user_res = supabase.table("users").insert({
            "full_name": payload.full_name,
            "email": payload.email,
            "mobile_number": payload.mobile_number,
            "password_hash": pw_hash,
            "marketing_opt_in": payload.marketing_opt_in,
            "subscription_tier": "free",
            "subscription_status": "active"
        }).execute()
    except Exception as e:
        err_msg = str(e)
        if "users_email_key" in err_msg or "email" in err_msg:
            raise HTTPException(status_code=400, detail="An account with this email address already exists.")
        if "users_mobile_number_key" in err_msg or "mobile_number" in err_msg:
            raise HTTPException(status_code=400, detail="An account with this mobile number already exists.")
        raise HTTPException(status_code=500, detail=f"Failed to create account: {err_msg}")

    if not user_res.data:
        raise HTTPException(status_code=500, detail="Failed to create account.")

    new_user = user_res.data[0]
    user_id = new_user["id"]

    # Generate and store email verification token (store hashed, send raw)
    try:
        raw_token = generate_secure_token()
        hashed = hash_token(raw_token)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
        supabase.table("email_verification_tokens").insert({
            "user_id": user_id,
            "token_hash": hashed,
            "expires_at": expires_at.isoformat()
        }).execute()

        # Send emails in background (non-blocking)
        background_tasks.add_task(send_verification_email, payload.email, payload.full_name, raw_token)
        background_tasks.add_task(send_welcome_email, payload.email, payload.full_name)
    except Exception as token_err:
        # Non-fatal during local development if email token table is skipped
        print(f"Warning: Email token setup skipped ({token_err})")

    return {
        "message": "Account created successfully! Please check your email to verify your account.",
        "user_id": user_id,
        "email": payload.email
    }


# --- Verify Email ---
@router.get("/verify-email")
def verify_email(token: str):
    """Verifies a user's email address using the token sent to their email."""
    supabase = get_supabase()
    hashed = hash_token(token)
    now = datetime.now(timezone.utc).isoformat()

    token_res = (
        supabase.table("email_verification_tokens")
        .select("*")
        .eq("token_hash", hashed)
        .gt("expires_at", now)
        .is_("used_at", "null")
        .single()
        .execute()
    )

    if not token_res.data:
        raise HTTPException(status_code=400, detail="Invalid or expired verification link.")

    token_record = token_res.data

    # Mark user as verified
    supabase.table("users").update({
        "email_verified_at": datetime.now(timezone.utc).isoformat()
    }).eq("id", token_record["user_id"]).execute()

    # Mark token as used
    supabase.table("email_verification_tokens").update({
        "used_at": datetime.now(timezone.utc).isoformat()
    }).eq("id", token_record["id"]).execute()

    return {"message": "Email verified successfully! You can now log in."}


# --- Login ---
@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest):
    """Authenticates a user, invalidates previous device sessions, and returns a JWT access token."""
    supabase = get_supabase()

    user_res = (
        supabase.table("users")
        .select("id, full_name, email, mobile_number, password_hash, subscription_tier, subscription_status, email_verified_at")
        .eq("email", payload.email)
        .single()
        .execute()
    )

    if not user_res.data:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    user = user_res.data

    if not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    # Record new login session timestamp to invalidate concurrent logins from other devices
    session_time = datetime.now(timezone.utc).isoformat()
    try:
        supabase.table("users").update({"updated_at": session_time}).eq("id", user["id"]).execute()
    except Exception as e:
        print(f"Warning: Failed to update login session time: {e}")

    token = create_access_token(user_id=user["id"], email=user["email"], session_time=session_time)

    safe_user = {k: v for k, v in user.items() if k != "password_hash"}
    apply_admin_overrides(safe_user)

    return {"access_token": token, "token_type": "bearer", "user": safe_user}


# --- Forgot Password ---
@router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest, background_tasks: BackgroundTasks):
    """
    Initiates the password reset flow.
    Always returns success (prevents email enumeration attacks).
    """
    supabase = get_supabase()
    user_res = supabase.table("users").select("id, full_name, email").eq("email", payload.email).execute()

    if user_res.data:
        user = user_res.data[0]
        raw_token = generate_secure_token()
        hashed = hash_token(raw_token)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=1)

        supabase.table("password_reset_tokens").insert({
            "user_id": user["id"],
            "token_hash": hashed,
            "expires_at": expires_at.isoformat()
        }).execute()

        background_tasks.add_task(send_password_reset_email, user["email"], user["full_name"], raw_token)

    return {"message": "If that email is registered, a password reset link has been sent."}


# --- Reset Password ---
@router.post("/reset-password")
async def reset_password(payload: ResetPasswordRequest, background_tasks: BackgroundTasks):
    """Resets the user's password using a valid reset token."""
    if payload.new_password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match.")

    supabase = get_supabase()
    hashed = hash_token(payload.token)
    now = datetime.now(timezone.utc).isoformat()

    token_res = (
        supabase.table("password_reset_tokens")
        .select("*")
        .eq("token_hash", hashed)
        .gt("expires_at", now)
        .is_("used_at", "null")
        .single()
        .execute()
    )

    if not token_res.data:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link.")

    token_record = token_res.data
    new_hash = hash_password(payload.new_password)

    supabase.table("users").update({"password_hash": new_hash}).eq("id", token_record["user_id"]).execute()
    supabase.table("password_reset_tokens").update({
        "used_at": datetime.now(timezone.utc).isoformat()
    }).eq("id", token_record["id"]).execute()

    # Send confirmation email in background
    user_res = supabase.table("users").select("email, full_name").eq("id", token_record["user_id"]).single().execute()
    if user_res.data:
        background_tasks.add_task(send_password_changed_email, user_res.data["email"], user_res.data["full_name"])

    return {"message": "Password reset successfully! You can now log in with your new password."}


# --- Change Password (authenticated) ---
@router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """Changes the password for the currently authenticated user."""
    if payload.new_password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match.")

    supabase = get_supabase()

    # Fetch current password hash
    user_res = supabase.table("users").select("password_hash, email, full_name").eq("id", current_user["id"]).single().execute()
    user = user_res.data

    if not verify_password(payload.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")

    new_hash = hash_password(payload.new_password)
    supabase.table("users").update({"password_hash": new_hash}).eq("id", current_user["id"]).execute()

    background_tasks.add_task(send_password_changed_email, user["email"], user["full_name"])

    return {"message": "Password changed successfully."}


# --- Me (get current user) ---
@router.get("/me")
def get_me(current_user: dict = Depends(get_current_user)):
    """Returns the authenticated user's profile."""
    return current_user
