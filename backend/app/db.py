from supabase import create_client, Client
from app.config import settings

_supabase_client: Client | None = None

def get_supabase() -> Client:
    """Returns an initialized Supabase client using service role key."""
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client

    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise ValueError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the .env file."
        )

    _supabase_client = create_client(
        supabase_url=settings.SUPABASE_URL,
        supabase_key=settings.SUPABASE_SERVICE_ROLE_KEY
    )
    return _supabase_client
