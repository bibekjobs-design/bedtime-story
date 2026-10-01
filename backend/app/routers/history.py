from fastapi import APIRouter, Depends, Query
from app.auth import get_current_user
from app.services.history_service import get_user_history, get_user_creations_with_ratings

router = APIRouter(prefix="/api/history", tags=["History"])


@router.get("/")
def get_history(
    limit: int = Query(default=60, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
):
    """
    This user's own narration history, latest first - Library plays,
    Create->Narrator generations, and Create->Clone narrations. Server-side,
    so it survives cache clears and follows the account across devices
    (unlike the old AsyncStorage-only history).
    """
    return get_user_history(current_user["id"], limit=limit)


@router.get("/my-creations")
def get_my_creations(
    limit: int = Query(default=60, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
):
    """
    Stories this user generated via Create->Narrator that are now shared in
    the Library, with their current average_rating/total_ratings - so a
    parent can see how their own uploads are being rated by other families.
    """
    return get_user_creations_with_ratings(current_user["id"], limit=limit)
