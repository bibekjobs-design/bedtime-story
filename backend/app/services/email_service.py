"""
SMTP email sender for the app - STORYLAND account emails (verification,
welcome, password reset/changed), payment confirmations, "plan ended"
notices, "Contact us" messages, and the admin cost/quota alert email.

Uses the MAIL_* settings defined in app/config.py (Gmail SMTP).
Every function here is best-effort: a failed or misconfigured send must
never raise into a request - everything logs and returns False instead.
"""
import os
import smtplib
import threading
from datetime import datetime
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from html import escape
from typing import Optional

from app.config import settings

SUPPORT_EMAIL = "storylandconnect@gmail.com"
BRAND = "STORYLAND"
ACCENT = "#e50914"  # the red of the app's "S" logo
LOGO_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "email_logo.png")


def _send_email(to_addr: str, subject: str, body: str, html: Optional[str] = None,
                reply_to: Optional[str] = None) -> bool:
    """Shared low-level sender. Returns True on success, False (never
    raises) if SMTP isn't configured or the send fails."""
    if not settings.MAIL_USERNAME or not settings.MAIL_PASSWORD:
        print(f"[email_service] MAIL_USERNAME/MAIL_PASSWORD not configured - skipping email: {subject}")
        return False

    from_addr = settings.MAIL_FROM or settings.MAIL_USERNAME

    if html:
        alt = MIMEMultipart("alternative")
        alt.attach(MIMEText(body, "plain", "utf-8"))
        alt.attach(MIMEText(html, "html", "utf-8"))
        logo = None
        if "cid:storyland_logo" in html:
            try:
                with open(LOGO_PATH, "rb") as fh:
                    logo = MIMEImage(fh.read(), _subtype="png")
                logo.add_header("Content-ID", "<storyland_logo>")
                logo.add_header("Content-Disposition", "inline", filename="storyland.png")
            except Exception as e:
                print(f"[email_service] logo not attached: {e}")
        if logo is not None:
            msg = MIMEMultipart("related")
            msg.attach(alt)
            msg.attach(logo)
        else:
            msg = alt
    else:
        msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = f"{BRAND} <{from_addr}>" if "<" not in from_addr else from_addr
    msg["To"] = to_addr
    if reply_to:
        msg["Reply-To"] = reply_to

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


def _in_background(fn, *args, **kwargs) -> None:
    """Runs a send without making the request wait for SMTP."""
    try:
        threading.Thread(target=fn, args=args, kwargs=kwargs, daemon=True).start()
    except Exception as e:
        print(f"[email_service] could not start background send: {e}")


def _wrap(title: str, inner_html: str) -> str:
    """Simple branded HTML shell (dark header, readable body)."""
    return f"""<!doctype html><html><body style="margin:0;padding:0;background:#f4f1ec;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec;padding:24px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#222;">
<tr><td style="background:#101119;padding:16px 28px;">
<table cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:14px;"><img src="cid:storyland_logo" width="52" height="52" alt="S" style="display:block;border-radius:12px;border:0;"></td>
<td style="color:#e50914;font-size:24px;font-weight:700;letter-spacing:3px;font-family:Georgia,'Times New Roman',serif;">{BRAND}</td>
</tr></table></td></tr>
<tr><td style="height:4px;background:{ACCENT};line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:28px;">
<h2 style="margin:0 0 14px 0;font-size:20px;color:#101119;">{escape(title)}</h2>
{inner_html}
<p style="margin:26px 0 0 0;font-size:13px;color:#777;">Questions? Write to us at <a href="mailto:{SUPPORT_EMAIL}" style="color:{ACCENT};">{SUPPORT_EMAIL}</a>.<br>Sweet dreams from the {BRAND} team.</p>
</td></tr></table></td></tr></table></body></html>"""


def _button(url: str, label: str) -> str:
    return (f'<p style="margin:20px 0;"><a href="{escape(url)}" style="background:{ACCENT};color:#ffffff;'
            f'text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;display:inline-block;">'
            f'{escape(label)}</a></p>')


# ---------------------------------------------------------------- account

def send_verification_email(email: str, full_name: str, raw_token: str) -> bool:
    """Sent on signup - link to confirm the account's email address."""
    verify_url = f"{settings.FRONTEND_URL}/verify-email?token={raw_token}"
    name = escape(full_name or "there")
    text = (
        f"Hi {full_name},\n\n"
        f"Welcome to {BRAND}! Please confirm your email address by opening this link:\n\n"
        f"{verify_url}\n\n"
        f"This link expires in 24 hours.\n\n"
        f"If you didn't create this account, you can safely ignore this email.\n\n"
        f"Questions? Write to {SUPPORT_EMAIL}."
    )
    html = _wrap("Confirm your email", (
        f'<p>Hi {name},</p><p>Welcome to {BRAND}! Please confirm your email address to finish setting up your account.</p>'
        + _button(verify_url, "Confirm my email") +
        '<p style="font-size:13px;color:#777;">This link expires in 24 hours. If you did not create this account, you can safely ignore this email.</p>'
    ))
    return _send_email(email, f"Confirm your {BRAND} email", text, html)


def send_welcome_email(email: str, full_name: str) -> bool:
    """Sent alongside the verification email on signup."""
    name = escape(full_name or "there")
    text = (
        f"Hi {full_name},\n\n"
        f"Welcome to {BRAND}! We're so glad you're here.\n\n"
        f"Your 30-day free trial has started. Here is what you can enjoy:\n"
        f"- A Library of calming stories\n"
        f"- Stories narrated in 5 languages: English, Hindi, Bengali, Kannada and Telugu\n"
        f"- A sleep timer, so the story stops by itself once your child is asleep\n"
        f"- Calming background sounds and child profiles for the whole family\n\n"
        f"Open the app, pick a story and let the night begin.\n\n"
        f"Questions? Write to {SUPPORT_EMAIL}.\n\nSweet dreams,\nThe {BRAND} team"
    )
    html = _wrap(f"Welcome to {BRAND}!", (
        f'<p>Hi {name},</p><p>We are so glad you are here. Your <b>30-day free trial</b> has started.</p>'
        '<ul style="padding-left:18px;line-height:1.7;">'
        '<li>A Library of calming stories</li>'
        '<li>Stories narrated in 5 languages: English, Hindi, Bengali, Kannada &amp; Telugu</li>'
        '<li>A sleep timer - the story stops by itself once your child is asleep</li>'
        '<li>Calming background sounds and child profiles for the whole family</li>'
        '</ul><p>Open the app, pick a story and let the night begin.</p>'
    ))
    return _send_email(email, f"Welcome to {BRAND}!", text, html)


def send_password_reset_email(email: str, full_name: str, raw_token: str) -> bool:
    """Sent when a user requests a password reset."""
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={raw_token}"
    name = escape(full_name or "there")
    text = (
        f"Hi {full_name},\n\n"
        f"We received a request to reset your {BRAND} password. Open this link to choose a new one:\n\n"
        f"{reset_url}\n\n"
        f"This link expires shortly. If you didn't request this, you can safely ignore this email - "
        f"your password will remain unchanged."
    )
    html = _wrap("Reset your password", (
        f'<p>Hi {name},</p><p>We received a request to reset your {BRAND} password.</p>'
        + _button(reset_url, "Choose a new password") +
        '<p style="font-size:13px;color:#777;">This link expires shortly. If you did not request this, you can safely ignore this email - your password stays unchanged.</p>'
    ))
    return _send_email(email, f"Reset your {BRAND} password", text, html)


def send_password_changed_email(email: str, full_name: str) -> bool:
    """Sent as a security notice after a password change/reset succeeds."""
    name = escape(full_name or "there")
    text = (
        f"Hi {full_name},\n\n"
        f"Your {BRAND} password was just changed. If this was you, no action is needed.\n\n"
        f"If you didn't make this change, please write to {SUPPORT_EMAIL} immediately."
    )
    html = _wrap("Your password was changed", (
        f'<p>Hi {name},</p><p>Your {BRAND} password was just changed. If this was you, no action is needed.</p>'
        f'<p>If you did not make this change, please write to us immediately at {SUPPORT_EMAIL}.</p>'
    ))
    return _send_email(email, f"Your {BRAND} password was changed", text, html)


# ------------------------------------------------------------- subscription

def _fmt_date(value) -> str:
    try:
        if isinstance(value, str):
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value.strftime("%d %b %Y")
    except Exception:
        return str(value or "")


def send_payment_email(email: str, full_name: str, plan_label: str, amount_inr, expires_at, autopay: bool = False) -> bool:
    """Thank-you / receipt-style confirmation after a successful payment."""
    name = escape(full_name or "there")
    until = _fmt_date(expires_at)
    renew_text = ("It renews automatically every month. You can cancel renewal anytime in the app."
                  if autopay else "It does not renew by itself - you can subscribe again any time.")
    text = (
        f"Hi {full_name},\n\n"
        f"Thank you! Your {BRAND} {plan_label} plan is active.\n\n"
        f"Plan: {BRAND} {plan_label}\n"
        f"Amount paid: Rs {amount_inr}\n"
        f"Valid until: {until}\n\n"
        f"{renew_text}\n\n"
        f"Questions about your payment? Write to {SUPPORT_EMAIL}.\n\nSweet dreams,\nThe {BRAND} team"
    )
    html = _wrap("Thank you - your plan is active", (
        f'<p>Hi {name},</p><p>Thank you for subscribing to <b>{BRAND} {escape(plan_label)}</b>.</p>'
        '<table cellpadding="6" style="border-collapse:collapse;font-size:14px;">'
        f'<tr><td style="color:#777;">Plan</td><td><b>{BRAND} {escape(plan_label)}</b></td></tr>'
        f'<tr><td style="color:#777;">Amount paid</td><td><b>&#8377;{escape(str(amount_inr))}</b></td></tr>'
        f'<tr><td style="color:#777;">Valid until</td><td><b>{escape(until)}</b></td></tr>'
        f'</table><p>{escape(renew_text)}</p>'
    ))
    return _send_email(email, f"Your {BRAND} {plan_label} plan is active", text, html)


def send_payment_admin_copy(user_name: str, user_email: str, plan_label: str, amount_inr, expires_at) -> bool:
    body = (
        f"New {BRAND} payment\n\n"
        f"User: {user_name} <{user_email}>\n"
        f"Plan: {plan_label}\nAmount: Rs {amount_inr}\nValid until: {_fmt_date(expires_at)}\n"
    )
    return _send_email(SUPPORT_EMAIL, f"{BRAND} payment: {plan_label} - Rs {amount_inr} - {user_email}", body)


def notify_payment(user_id: str, plan_label: str, amount_inr, expires_at, autopay: bool = False) -> None:
    """Looks up the user and sends the buyer's thank-you email plus a copy to
    the admin mailbox. Runs in the background; never raises."""
    def _work():
        try:
            from app.db import get_supabase
            r = get_supabase().table("users").select("full_name, email").eq("id", user_id).limit(1).execute()
            if not r.data:
                return
            u = r.data[0]
            if u.get("email"):
                send_payment_email(u["email"], u.get("full_name") or "", plan_label, amount_inr, expires_at, autopay)
                send_payment_admin_copy(u.get("full_name") or "", u["email"], plan_label, amount_inr, expires_at)
        except Exception as e:
            print(f"[email_service] payment notification skipped: {e}")
    _in_background(_work)


def send_plan_ended_email(email: str, full_name: str) -> bool:
    name = escape(full_name or "there")
    text = (
        f"Hi {full_name},\n\n"
        f"Your {BRAND} plan has ended, so your account is back on the free plan.\n\n"
        f"Your child profiles and history are safe. To keep listening to every story, open the app and "
        f"choose a plan any time.\n\n"
        f"Questions? Write to {SUPPORT_EMAIL}.\n\nSweet dreams,\nThe {BRAND} team"
    )
    html = _wrap("Your plan has ended", (
        f'<p>Hi {name},</p><p>Your {BRAND} plan has ended, so your account is back on the free plan.</p>'
        '<p>Your child profiles and history are safe. To keep listening to every story, open the app and choose a plan any time.</p>'
    ))
    return _send_email(email, f"Your {BRAND} plan has ended", text, html)


def notify_plan_ended(email: str, full_name: str) -> None:
    _in_background(send_plan_ended_email, email, full_name)


# ------------------------------------------------------------ contact / admin

def send_contact_message_email(user_name: str, user_email: str, plan: str, message: str) -> bool:
    """A user's 'Contact us' message, delivered to the admin mailbox. Reply
    in Gmail goes straight to the user."""
    body = (
        f"New message from a {BRAND} user\n\n"
        f"Name: {user_name}\nEmail: {user_email}\nPlan: {plan}\n\n"
        f"{message}\n"
    )
    return _send_email(SUPPORT_EMAIL, f"{BRAND} message from {user_name or user_email}", body, reply_to=user_email)


def send_admin_alert_email(subject: str, body: str) -> bool:
    """Admin-only alert (e.g. Google TTS free-quota thresholds from
    tts_usage_service.py). Sends to MAIL_FROM/MAIL_USERNAME (the admin's own
    mailbox), not to an arbitrary end-user address."""
    to_addr = settings.MAIL_FROM or settings.MAIL_USERNAME
    if not to_addr:
        print(f"[email_service] No admin mailbox configured - skipping alert: {subject}")
        return False
    return _send_email(to_addr, subject, body)
