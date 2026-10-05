from fastapi import APIRouter, HTTPException, Query, status, Depends, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

from app.db import get_supabase
from app.auth import get_current_user, get_current_user_optional
from app.services.story_service import (
    get_precreated_stories,
    generate_custom_story,
    generate_multimodal_story,
    commit_and_narrate_story,
    search_stories,
    browse_story_options,
    get_ambient_track_for_story,
    rate_story,
    publish_manual_story,
    get_story_admin_detail,
    update_manual_story,
    delete_story_completely,
)

router = APIRouter(prefix="/api/stories", tags=["Stories"])


def _creation_limit_message(effective_tier: str, used: int, limit: int) -> str:
    """Friendly 403 text for 'you can't create (more) stories' per plan."""
    if effective_tier in ("premium", "premium_monthly", "premium_annual"):
        return f"Monthly limit reached ({used}/{limit} stories used on Super). Your quota will reset next month."
    if effective_tier == "pro_monthly":
        return (
            f"Monthly limit reached ({used}/{limit} stories used on Pro). "
            "Upgrade to Super (₹219/month) for 8 stories/month + parent voice cloning!"
        )
    if effective_tier == "normal_monthly":
        return (
            "Your Normal plan (₹99/month) is for listening to the Library. "
            "Upgrade to Pro (₹151/month) to create 5 AI-narrated stories a month, "
            "or Super (₹219/month) for 8 stories + parent voice cloning."
        )
    if effective_tier == "free_expired":
        return (
            "Your free trial has ended. Subscribe to Pro (₹151/month, 5 stories) or "
            "Super (₹219/month, 8 stories + voice cloning) to keep creating new stories. "
            "You can still enjoy the full Library for free anytime!"
        )
    return (
        f"You have used your free trial story ({used}/{limit}). "
        "Upgrade to Pro (₹151/month) or Super (₹219/month) to create more stories!"
    )

ADMIN_EMAILS = {"bibekjobs@gmail.com"}


def _is_admin_user(user: Optional[dict]) -> bool:
    """Shared admin check for the Library-publishing gate (admin-only new
    content) - same rule used everywhere else in the app (subscriptions.py,
    stories.py's generate endpoints, voice_clones.py)."""
    if not user:
        return False
    email = (user.get("email") or "").lower().strip()
    tier = (user.get("subscription_tier") or "").lower().strip()
    return email in ADMIN_EMAILS or tier in ("admin", "admin_vip", "superadmin")


class StoryTeaserResponse(BaseModel):
    id: str
    category_id: Optional[str] = None
    age_group_id: Optional[int] = None
    language_id: Optional[int] = 1
    title: str
    teaser: str
    generation_status: str
    has_audio: Optional[bool] = False
    has_images: Optional[bool] = False
    audio_url: Optional[str] = None
    duration_seconds: Optional[int] = None
    scenes_count: Optional[int] = 0
    ambient_sound: Optional[Dict[str, Any]] = None
    average_rating: Optional[float] = 5.0
    total_ratings: Optional[int] = 1
    cover_image_url: Optional[str] = None
    cover_image_upload_failed: Optional[bool] = None


class BrowseStoriesRequest(BaseModel):
    category_id: Optional[str] = Field(default=None, description="UUID of selected story category")
    age_group_id: int = Field(default=1, description="ID of selected age group")
    language_id: int = Field(default=1, description="ID of language")
    target_count: Optional[int] = Field(default=20)


@router.get("/precreated")
def get_precreated_stories_endpoint(
    category_id: Optional[str] = Query(None, description="Category UUID"),
    age_group_id: int = Query(1, description="Age group ID"),
    language_id: int = Query(1, description="Language ID"),
    sort_by: str = Query("popular", description="Sort by: 'popular', 'top_rated', 'newest'"),
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    """
    Tab 1: Listen to Story
    Returns pre-created bedtime stories already stored in the DB.
    Instant <5ms fetch from in-memory cache. Zero AI cost, ambient soundscape, star ratings.
    Uses JSONResponse directly (no Pydantic re-serialization) for maximum speed.
    Auto-seeding a brand-new empty category is admin-only - see get_precreated_stories.
    """
    try:
        data = get_precreated_stories(
            category_id=category_id,
            age_group_id=age_group_id,
            language_id=language_id,
            sort_by=sort_by,
            is_admin=_is_admin_user(current_user),
        )
        return JSONResponse(content=data)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch library stories: {str(exc)}"
        )


@router.post("/browse", response_model=List[StoryTeaserResponse])
def browse_stories_post(
    payload: BrowseStoriesRequest,
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    """Convenience browse endpoint returning pre-created stories."""
    try:
        return get_precreated_stories(
            category_id=payload.category_id,
            age_group_id=payload.age_group_id,
            language_id=payload.language_id,
            is_admin=_is_admin_user(current_user),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to browse stories: {str(exc)}"
        )


@router.get("/browse", response_model=List[StoryTeaserResponse])
def browse_stories_get(
    category_id: Optional[str] = Query(None),
    age_group_id: int = Query(1),
    language_id: int = Query(1),
    target_count: int = Query(20),
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    return browse_stories_post(
        BrowseStoriesRequest(
            category_id=category_id,
            age_group_id=age_group_id,
            language_id=language_id,
            target_count=target_count
        ),
        current_user=current_user,
    )


class GenerateCustomStoryRequest(BaseModel):
    prompt: str = Field(..., min_length=2, description="Story topic, idea, or theme")
    age_group_id: int = Field(default=1, description="Target age group")
    category_id: Optional[str] = Field(default=None, description="Optional category")
    language_id: int = Field(default=1, description="Language ID")
    voice_id: Optional[str] = Field(default="luna", description="Narrator persona: luna, oliver, willow, jasper")
    accent_id: Optional[str] = Field(default="us", description="Accent/locale: us, gb, in, au")


class StoryCommitResponse(BaseModel):
    story_text_id: str
    title: str
    teaser: str
    full_text: str
    audio_url: str
    duration_seconds: int
    voice_tier: str
    provider: str
    ambient_sound: Optional[Dict[str, Any]] = None
    cached: bool
    truncated: Optional[bool] = False
    notice: Optional[str] = None


@router.post("/generate-custom", response_model=StoryCommitResponse)
def generate_custom_story_endpoint(
    payload: GenerateCustomStoryRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Tab 2: Generate New Story
    Creates an original 5-7 min bedtime story from a topic/prompt in chosen narrator voice.
    Free trial: 1 story. Pro: 5/month. Super: 8/month. Normal: listen only.
    """
    from app.services.usage_service import get_monthly_usage, TIER_LIMITS
    from app.services.subscription_policy import is_trial_active
    tier = current_user.get("subscription_tier", "free")
    email = (current_user.get("email") or "").lower().strip()
    is_admin = email in {"bibekjobs@gmail.com"} or tier in ("admin", "admin_vip", "superadmin")

    if is_admin:
        tier = "admin_vip"

    # "free" only means "trial not yet proven expired" - if the trial has
    # actually lapsed and the user never subscribed, treat them as
    # "free_expired" (0 stories, 0 clones). This is the enforcement point
    # that was previously missing entirely: a lapsed-trial free user used
    # to keep getting the same 10 stories/month forever.
    effective_tier = tier
    if tier == "free" and not is_admin and not is_trial_active(current_user.get("created_at")):
        effective_tier = "free_expired"

    if not is_admin:
        usage = get_monthly_usage(current_user["id"])
        limits = TIER_LIMITS.get(effective_tier, TIER_LIMITS["free_expired"])
        story_limit = limits.get("new_story_generation", 0)
        story_used = usage.get("new_story_generation", 0)

        if story_used >= story_limit:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=_creation_limit_message(effective_tier, story_used, story_limit),
            )

    try:
        result = generate_custom_story(
            prompt=payload.prompt,
            age_group_id=payload.age_group_id,
            category_id=payload.category_id,
            language_id=payload.language_id,
            voice_id=payload.voice_id or "luna",
            user_id=current_user["id"],
            subscription_tier=effective_tier,
            accent_id=payload.accent_id or "us",
        )
        return result
    except ValueError as val_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err)
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Custom story generation failed: {str(exc)}"
        )


@router.post("/convert-to-story", response_model=StoryCommitResponse)
async def convert_to_story_endpoint(
    input_mode: str = Form("text"),  # 'text' | 'image' | 'pdf'
    prompt: Optional[str] = Form(None),
    age_group_id: int = Form(1),
    category_id: Optional[str] = Form(None),
    language_id: int = Form(1),
    voice_id: Optional[str] = Form("luna"),
    accent_id: Optional[str] = Form("us", description="Accent/locale: us, gb, in, au"),
    pdf_page_from: Optional[int] = Form(None, description="PDF 'Page Range' mode: first page to read (1-indexed)"),
    pdf_page_to: Optional[int] = Form(None, description="PDF 'Page Range' mode: last page to read (1-indexed)"),
    file: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user)
):
    """
    Multimodal Story Conversion:
    Accepts:
    - Text prompt/idea
    - Photo/screenshot of a storybook page (image/jpeg, image/png)
    - PDF document (application/pdf) - either the whole document, or (via
      pdf_page_from/pdf_page_to) just a specific page range.

    Transforms content into a sleepy, comforting bedtime audio story via Gemini 2.0 Flash!
    """
    from app.services.usage_service import get_monthly_usage, TIER_LIMITS
    from app.services.subscription_policy import is_trial_active
    tier = current_user.get("subscription_tier", "free")
    email = (current_user.get("email") or "").lower().strip()
    is_admin = email in {"bibekjobs@gmail.com"} or tier in ("admin", "admin_vip", "superadmin")

    if is_admin:
        tier = "admin_vip"

    effective_tier = tier
    if tier == "free" and not is_admin and not is_trial_active(current_user.get("created_at")):
        effective_tier = "free_expired"

    if not is_admin:
        usage = get_monthly_usage(current_user["id"])
        limits = TIER_LIMITS.get(effective_tier, TIER_LIMITS["free_expired"])
        story_limit = limits.get("new_story_generation", 0)
        story_used = usage.get("new_story_generation", 0)

        if story_used >= story_limit:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=_creation_limit_message(effective_tier, story_used, story_limit),
            )

    file_bytes = None
    file_mime = None
    file_name = None
    if file:
        file_bytes = await file.read()
        file_mime = file.content_type
        file_name = file.filename

    try:
        result = generate_multimodal_story(
            input_mode=input_mode,
            text_prompt=prompt,
            file_bytes=file_bytes,
            file_mime_type=file_mime,
            file_name=file_name,
            age_group_id=age_group_id,
            category_id=category_id,
            language_id=language_id,
            voice_id=voice_id or "luna",
            user_id=current_user["id"],
            subscription_tier=effective_tier,
            pdf_page_from=pdf_page_from,
            pdf_page_to=pdf_page_to,
            accent_id=accent_id or "us",
        )
        return result
    except ValueError as val_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err)
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Multimodal story creation failed: {str(exc)}"
        )


class CommitStoryRequest(BaseModel):
    voice_tier: Optional[str] = Field(default="standard", description="'standard' or 'deluxe'")
    voice_id: Optional[str] = Field(default="luna", description="Narrator persona: luna, oliver, willow, jasper")
    accent_id: Optional[str] = Field(default="us", description="Accent/locale: us, gb, in, au")


@router.post("/{story_text_id}/commit", response_model=StoryCommitResponse)
def commit_story(
    story_text_id: str,
    payload: Optional[CommitStoryRequest] = None,
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    """
    Plays / commits a pre-created or library story.
    Returns cached audio in 0.1s if available, or renders narration and returns with ambient sound.
    Writing brand-new Library content (a teaser-only stub) is admin-only -
    see commit_and_narrate_story.
    """
    voice_tier = payload.voice_tier if payload else "standard"
    voice_id = payload.voice_id if payload else "luna"
    accent_id = payload.accent_id if payload else "us"
    try:
        result = commit_and_narrate_story(
            story_text_id=story_text_id,
            voice_tier=voice_tier,
            voice_id=voice_id,
            user_id=current_user["id"] if current_user else None,
            is_admin=_is_admin_user(current_user),
            accent_id=accent_id or "us",
        )
        return result
    except ValueError as val_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err)
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Story commit failed: {str(exc)}"
        )


@router.get("/usage")
def get_user_story_usage(current_user: dict = Depends(get_current_user)):
    """Returns current month's remaining and used quotas for the caller's actual plan."""
    from app.services.usage_service import get_monthly_usage, TIER_LIMITS
    from app.services.subscription_policy import is_trial_active
    usage = get_monthly_usage(current_user["id"])
    tier = current_user.get("subscription_tier", "free")
    email = (current_user.get("email") or "").lower().strip()
    is_admin = email in {"bibekjobs@gmail.com"} or tier in ("admin", "admin_vip", "superadmin")

    effective_tier = "admin_vip" if is_admin else tier
    if effective_tier == "free" and not is_trial_active(current_user.get("created_at")):
        effective_tier = "free_expired"

    limits = TIER_LIMITS.get(effective_tier, TIER_LIMITS["free_expired"])

    story_used = usage.get("new_story_generation", 0)
    story_limit = limits.get("new_story_generation", 0)

    clone_used = usage.get("voice_clone_story", 0)
    clone_limit = limits.get("voice_clone_story", 0)

    return {
        "tier": tier,
        "effective_tier": effective_tier,
        "is_admin": is_admin,
        "new_story_used": story_used,
        "new_story_limit": story_limit,
        "new_story_remaining": max(0, story_limit - story_used),
        "voice_clone_used": clone_used,
        "voice_clone_limit": clone_limit,
        "voice_clone_remaining": max(0, clone_limit - clone_used),
    }


class SearchStoriesRequest(BaseModel):
    query: str
    age_group_id: int
    language_id: int = 1
    allow_ai_generate: bool = False
    category_id: Optional[str] = None  # admin-only: which category to publish a generated story to


@router.post("/search", response_model=List[StoryTeaserResponse])
def search_stories_endpoint(
    payload: SearchStoriesRequest,
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    """Generating a new story when the search finds nothing is admin-only -
    see search_stories."""
    try:
        return search_stories(
            query=payload.query,
            age_group_id=payload.age_group_id,
            language_id=payload.language_id,
            allow_ai_generate=payload.allow_ai_generate,
            is_admin=_is_admin_user(current_user),
            category_id=payload.category_id,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Search failed: {str(exc)}"
        )


@router.post("/publish-manual", response_model=StoryTeaserResponse)
async def publish_manual_story_endpoint(
    title: str = Form(...),
    full_text: str = Form(...),
    category_id: str = Form(...),
    age_group_id: int = Form(...),
    language_id: int = Form(1),
    teaser: Optional[str] = Form(None),
    voice_id: Optional[str] = Form("luna"),
    accent_id: Optional[str] = Form("us", description="Accent/locale: us, gb, in, au"),
    cover_image: Optional[UploadFile] = File(None),
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    """
    Admin's ONLY story-creation path: the admin types/pastes the full story
    text directly and picks a category (existing or newly created), a
    narrator voice (Luna/Oliver/Willow/Jasper) and an accent (US/UK/Indian/
    Australian English), plus an optional cover picture. No Gemini call at
    all here - just Google TTS narration (in the chosen voice + accent) and
    a DB save, so this can never fail from Gemini being rate-limited or
    overloaded. Admin-only.
    """
    if not _is_admin_user(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only.")

    cover_bytes = None
    cover_mime = None
    if cover_image:
        cover_bytes = await cover_image.read()
        cover_mime = cover_image.content_type

    try:
        return publish_manual_story(
            title=title,
            full_text=full_text,
            category_id=category_id,
            age_group_id=age_group_id,
            language_id=language_id,
            teaser=teaser,
            voice_id=voice_id or "luna",
            accent_id=accent_id or "us",
            cover_image_bytes=cover_bytes,
            cover_image_mime=cover_mime,
        )
    except ValueError as val_err:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(val_err))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Publishing failed: {str(exc)}"
        )


@router.get("/{story_text_id}/admin-detail")
def get_story_admin_detail_endpoint(
    story_text_id: str,
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    """
    Full editable detail for the admin "Edit Story" screen - title, full
    text, teaser, cover image, and the narrator voice + accent this story
    is currently narrated with. Admin-only.
    """
    if not _is_admin_user(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only.")
    try:
        return get_story_admin_detail(story_text_id)
    except ValueError as val_err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(val_err))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load story: {str(exc)}"
        )


@router.post("/{story_text_id}/edit", response_model=StoryTeaserResponse)
async def edit_story_endpoint(
    story_text_id: str,
    title: Optional[str] = Form(None),
    full_text: Optional[str] = Form(None),
    teaser: Optional[str] = Form(None),
    remove_cover_image: Optional[bool] = Form(False),
    cover_image: Optional[UploadFile] = File(None),
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    """
    Admin edit of an already-published story: change its title, full text
    and/or cover image (category and narrator voice/accent stay fixed). If
    the text changed, the narration is re-synthesized immediately with the
    same voice/accent the story already used. Admin-only.
    """
    if not _is_admin_user(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only.")

    cover_bytes = None
    cover_mime = None
    if cover_image:
        cover_bytes = await cover_image.read()
        cover_mime = cover_image.content_type

    try:
        return update_manual_story(
            story_text_id=story_text_id,
            title=title,
            full_text=full_text,
            teaser=teaser,
            cover_image_bytes=cover_bytes,
            cover_image_mime=cover_mime,
            remove_cover_image=bool(remove_cover_image),
        )
    except ValueError as val_err:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(val_err))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Update failed: {str(exc)}"
        )


@router.delete("/{story_text_id}")
def delete_story_endpoint(
    story_text_id: str,
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    """
    Admin hard delete: permanently removes the story and everything
    derived from it (cached narration, cover image, ratings, personalized
    copies, and history entries) - see delete_story_completely. Cannot be
    undone. Admin-only.
    """
    if not _is_admin_user(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only.")
    try:
        delete_story_completely(story_text_id)
        return {"deleted": True, "story_text_id": story_text_id}
    except ValueError as val_err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(val_err))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Delete failed: {str(exc)}"
        )


from app.services.personalization_service import create_or_get_personalized_story

class PersonalizeStoryRequest(BaseModel):
    child_profile_id: str = Field(..., description="UUID of child profile to personalize for")
    voice_tier: Optional[str] = Field(default="standard", description="'standard' or 'deluxe'")

class PersonalizeStoryResponse(BaseModel):
    id: Optional[str]
    child_name: str
    full_text: str
    audio_url: str
    duration_seconds: int
    voice_tier: str
    cached: bool
    ambient_sound: Optional[Dict[str, Any]] = None

@router.post("/{story_text_id}/personalize", response_model=PersonalizeStoryResponse)
def personalize_story(
    story_text_id: str,
    payload: PersonalizeStoryRequest,
    current_user: dict = Depends(get_current_user)
):
    try:
        res = create_or_get_personalized_story(
            user_id=current_user["id"],
            subscription_tier=current_user.get("subscription_tier", "free"),
            child_profile_id=payload.child_profile_id,
            base_story_text_id=story_text_id,
            voice_tier=payload.voice_tier or "standard"
        )
        return res
    except ValueError as val_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err)
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Personalization failed: {str(exc)}"
        )


class RateStoryRequest(BaseModel):
    rating: int = Field(..., ge=1, le=5, description="Star rating from 1 to 5")
    device_id: Optional[str] = Field(default=None, description="Optional device ID for anonymous or trial users")


@router.post("/{story_text_id}/rate")
def rate_story_endpoint(
    story_text_id: str,
    payload: RateStoryRequest,
):
    """
    Submits a 1-5 star user rating for a bedtime story.
    Updates the story's average rating and total ratings in real time.
    """
    try:
        supabase = get_supabase()
        result = rate_story(
            supabase=supabase,
            story_text_id=story_text_id,
            rating=payload.rating,
            user_id=None,
            device_id=payload.device_id
        )
        return result
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Rating failed: {str(exc)}"
        )

