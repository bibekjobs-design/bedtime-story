import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Base backend directory
BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    # Supabase (required)
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""

    # Server settings
    PORT: int = 8000
    ENVIRONMENT: str = "development"

    # Future stages (LLM & TTS)
    GEMINI_API_KEY: str = ""
    GOOGLE_TTS_API_KEY: str = ""
    GOOGLE_APPLICATION_CREDENTIALS: str = ""
    ELEVENLABS_API_KEY: str = ""

    # Razorpay (real payments)
    RAZORPAY_KEY_ID: str = ""
    RAZORPAY_KEY_SECRET: str = ""
    RAZORPAY_WEBHOOK_SECRET: str = ""
    # Razorpay Subscriptions (auto-renew) plan IDs. These defaults are the
    # TEST-mode plans (Normal Rs 99/month, Pro Rs 219/month). When you switch
    # to live keys, create the same two plans in LIVE mode and set these two
    # variables on the server to the live plan IDs.
    # Normal = Rs 99, Pro = Rs 151 (new), Super = Rs 219 (the old "Pro").
    # NOTE: the variable called RAZORPAY_PLAN_ID_PRO below is the Rs 219 SUPER
    # plan (name kept so existing server settings keep working);
    # RAZORPAY_PLAN_ID_PRO151 is the new Rs 151 Pro plan.
    RAZORPAY_PLAN_ID_NORMAL: str = "plan_Tig3YXLHIzXYSn"
    RAZORPAY_PLAN_ID_PRO: str = "plan_Tig4n02bWl8xML"
    RAZORPAY_PLAN_ID_PRO151: str = "plan_TkJL8NacDgCKLt"

    # JWT Auth
    JWT_SECRET_KEY: str = "change-this-to-a-long-random-secret-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7   # 7 days

    # Email (SMTP) — for verification, password reset emails
    MAIL_USERNAME: str = ""
    MAIL_PASSWORD: str = ""
    MAIL_FROM: str = ""
    MAIL_SERVER: str = "smtp.gmail.com"
    MAIL_PORT: int = 587
    MAIL_STARTTLS: bool = True
    MAIL_SSL_TLS: bool = False
    FRONTEND_URL: str = "http://localhost:8081"  # Expo dev URL, update for prod

    model_config = SettingsConfigDict(
        env_file=(BASE_DIR / ".env", BASE_DIR / "env.txt", ".env", "env.txt"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()

# Automatically configure Google Cloud credentials if google-tts.json exists in backend
default_tts_cred = BASE_DIR / "google-tts.json"
if not settings.GOOGLE_APPLICATION_CREDENTIALS and default_tts_cred.exists():
    settings.GOOGLE_APPLICATION_CREDENTIALS = str(default_tts_cred)
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(default_tts_cred)
elif settings.GOOGLE_APPLICATION_CREDENTIALS:
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = settings.GOOGLE_APPLICATION_CREDENTIALS

