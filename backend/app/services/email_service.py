"""
SMTP email sender for the app - account emails (verification, password
reset/changed, welcome) used by app/routers/auth.py, plus the admin
cost/quota alert email used by tts_usage_service.py.

Uses the MAIL_* settings already defined in app/config.py (Gmail SMTP).
Every function here is best-effort: auth.py calls these via
BackgroundTasks.add_task(), so a failed/misconfigured send must never
raise into the request/response cycle - everything here logs and returns
rather than raising.

NOTE: this file was accidentally overwritten on 2026-09-25 while adding the
admin TTS-quota alert email, which briefly broke backend startup (auth.py
imports the four account-email functions below). This is a reconstruction
of those four functions - functionally equivalent, wording may differ
slightly from the original.
"""
import smtplib
from email.mime.text import MIMEText

from app.config import settings


def _send_email(to_addr: str, subject: str, body: str) -> bool:
    """Shared low-level sender. Returns True on success, False (never
    raises) if SMTP isn't configured or the send fails."""
    if not settings.MAIL_USERNAME or not settings.MAIL_PASSWORD:
        print(f"[email_service] MAIL_USERNAME/MAIL_PASSWORD not configured - skipping email: {subject}")
        return False

    from_addr = settings.MAIL_FROM or settings.MAIL_USERNAME

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr

    try:
        if settings.MAIL_SSL_TLS:
            server = smtplib.SMTP_SSL(settings.MAIL_SERVER, settings.MAIL_PORT, timeout=10)
        else:
            server = smtplib.SMTP(settings.MAIL_SERVER, settings.MAIL_PORT, timeout=10)
            if settings.MAIL_STARTTLS:
                server.starttls()
        server.login(settings.MAIL_USERNAME, settings.MAIL_PASSWORD)
        server.sendmail(from_addr, [to_addr], msg.as_string())
        server.quit()
        print(f"[email_service] Email sent to {to_addr}: {subject}")
        return True
    except Exception as e:
        print(f"[email_service] Failed to send email ({subject}) to {to_addr}: {e}")
        return False


def send_verification_email(email: str, full_name: str, raw_token: str) -> bool:
    """Sent on signup - link to confirm the account's email address."""
    verify_url = f"{settings.FRONTEND_URL}/verify-email?token={raw_token}"
    body = (
        f"Hi {full_name},\n\n"
        f"Welcome to Bedtime Story! Please verify your email address by opening this link:\n\n"
        f"{verify_url}\n\n"
        f"This link expires in 24 hours.\n\n"
        f"If you didn't create this account, you can safely ignore this email."
    )
    return _send_email(email, "Verify your Bedtime Story account", body)


def send_welcome_email(email: str, full_name: str) -> bool:
    """Sent alongside the verification email on signup."""
    body = (
        f"Hi {full_name},\n\n"
        f"Welcome to Bedtime Story! We're glad you're here.\n\n"
        f"Browse the Library for ready-made stories, or create your own custom "
        f"bedtime tales anytime. Sweet dreams!"
    )
    return _send_email(email, "Welcome to Bedtime Story!", body)


def send_password_reset_email(email: str, full_name: str, raw_token: str) -> bool:
    """Sent when a user requests a password reset."""
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={raw_token}"
    body = (
        f"Hi {full_name},\n\n"
        f"We received a request to reset your Bedtime Story password. Open this link to choose a new one:\n\n"
        f"{reset_url}\n\n"
        f"This link expires shortly. If you didn't request this, you can safely ignore this email - "
        f"your password will remain unchanged."
    )
    return _send_email(email, "Reset your Bedtime Story password", body)


def send_password_changed_email(email: str, full_name: str) -> bool:
    """Sent as a security notice after a password change/reset succeeds."""
    body = (
        f"Hi {full_name},\n\n"
        f"Your Bedtime Story password was just changed. If this was you, no action is needed.\n\n"
        f"If you didn't make this change, please contact us immediately."
    )
    return _send_email(email, "Your Bedtime Story password was changed", body)


def send_admin_alert_email(subject: str, body: str) -> bool:
    """Admin-only alert (e.g. Google TTS free-quota thresholds from
    tts_usage_service.py). Sends to MAIL_FROM/MAIL_USERNAME (the admin's own
    mailbox), not to an arbitrary end-user address."""
    to_addr = settings.MAIL_FROM or settings.MAIL_USERNAME
    if not to_addr:
        print(f"[email_service] No admin mailbox configured - skipping alert: {subject}")
        return False
    return _send_email(to_addr, subject, body)
