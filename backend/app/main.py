from fastapi import FastAPI, Response, status
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.db import get_supabase

app = FastAPI(
    title="Bedtime Story API",
    description="Backend API for AI-powered podcast-style Bedtime Stories for kids.",
    version="1.0.0"
)

# Enable robust CORS for mobile app and web development (Expo & Localhost)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=r"^https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.routers import lookups, stories, auth, profiles, voice_clones, subscriptions, admin, history, announcements, privacy
app.include_router(lookups.router)
app.include_router(stories.router)
app.include_router(auth.router)
app.include_router(profiles.router)
app.include_router(voice_clones.router)
app.include_router(subscriptions.router)
app.include_router(admin.router)
app.include_router(history.router)
app.include_router(announcements.router)
app.include_router(privacy.router)


@app.on_event("startup")
def prewarm_story_cache():
    """Pre-warms library story cache in parallel so mobile devices get instant <1ms response."""
    import concurrent.futures
    try:
        from app.services.story_service import get_precreated_stories
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            f1 = executor.submit(get_precreated_stories, None, 1, 1)  # Toddlers
            f2 = executor.submit(get_precreated_stories, None, 2, 1)  # Kids
            f3 = executor.submit(get_precreated_stories, None, 3, 1)  # Older Kids
            f1.result()
            f2.result()
            f3.result()
        print("Story library cache pre-warmed for all age groups in parallel (0ms ready).")
    except Exception as e:
        print(f"Pre-warm note: {e}")


@app.on_event("startup")
def start_voice_clone_cleanup():
    """Every hour, delete voice clones whose 10-day window is over."""
    import threading, time

    def loop():
        while True:
            try:
                from app.services.voice_clone_service import purge_expired_voice_clones
                n = purge_expired_voice_clones()
                if n:
                    print(f"[privacy] removed {n} expired voice clone(s)")
            except Exception as e:
                print(f"[privacy] cleanup note: {e}")
            time.sleep(3600)

    threading.Thread(target=loop, daemon=True).start()


@app.get("/")
def read_root():
    return {
        "service": "Bedtime Story API",
        "status": "online",
        "version": "1.0.0"
    }

@app.get("/api/health")
def health_check(response: Response):
    """
    Health check endpoint: verifies server status and Supabase connectivity.
    """
    health_data = {
        "status": "ok",
        "environment": settings.ENVIRONMENT,
        "database": "unknown"
    }

    # Verify Supabase credentials configuration
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        health_data["status"] = "degraded"
        health_data["database"] = "unconfigured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env"
        return health_data

    # Test live Supabase connection using the seeded 'age_groups' table
    try:
        supabase = get_supabase()
        db_res = supabase.table("age_groups").select("id, label").limit(1).execute()
        health_data["database"] = "connected"
        health_data["database_sample"] = db_res.data
    except Exception as exc:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        health_data["status"] = "degraded"
        health_data["database"] = f"connection_failed: {str(exc)}"

    return health_data
