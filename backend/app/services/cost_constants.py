"""
Shared cost/pricing constants - single source of truth so admin.py's cost
dashboard and tts_usage_service.py's live quota tracker can never drift
apart from each other.

These are the vendor numbers as of when this was built (Sep 2026). Vendor
pricing/plans change over time - re-verify against the actual ElevenLabs/
Google Cloud billing pages before trusting the INR estimates for a real
budget decision.
"""

ELEVENLABS_PLAN_CHAR_LIMIT_MONTHLY = 40000       # Starter plan, confirmed live via check_elevenlabs.py
ELEVENLABS_PLAN_COST_USD = 6                     # Starter plan flat monthly cost
GOOGLE_TTS_FREE_CHAR_LIMIT_MONTHLY = 1_000_000   # Chirp3-HD free tier, shared across the WHOLE platform
GOOGLE_TTS_COST_PER_MILLION_CHARS_USD = 30       # approx published rate beyond free tier
USD_TO_INR = 95  # approximate (Sept 2026); refresh periodically
