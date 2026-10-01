"""
Generates a single cover picture per story category, using Google's Imagen
model through the same google-genai client/API key already used for Gemini
text generation elsewhere in this app (app.config.settings.GEMINI_API_KEY).

This is intentionally a ONE-TIME, admin-triggered action per category, not
something that runs per-user or per-view: the resulting image is uploaded to
Supabase Storage once and its public URL is saved on the category row, so
every user afterwards just sees the already-stored picture at zero ongoing
cost. Re-running it for the same category overwrites the old image (upsert).
"""
from google import genai
from app.config import settings
from app.db import get_supabase

CATEGORY_IMAGE_BUCKET = "category-images"
IMAGEN_MODEL = "imagen-4.0-generate-001"


def generate_category_image(category_id: str, category_name: str, category_description: str = "") -> str:
    """
    Generates and stores one cover image for a category. Returns the public
    URL, and also writes it to story_categories.image_url.
    """
    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    prompt = (
        f"A warm, cozy, gentle children's bedtime-storybook illustration "
        f"representing the theme '{category_name}'"
        + (f" ({category_description})" if category_description else "")
        + ". Soft watercolor style, night-time color palette with deep blues "
        "and warm amber glow, whimsical and calming, no text or letters in "
        "the image, safe and friendly for young children."
    )

    response = client.models.generate_images(
        model=IMAGEN_MODEL,
        prompt=prompt,
        config={"number_of_images": 1},
    )

    if not response.generated_images:
        raise ValueError(f"Image generation returned no results for category '{category_name}'.")

    image_bytes = response.generated_images[0].image.image_bytes

    supabase = get_supabase()
    storage_path = f"{category_id}.png"
    supabase.storage.from_(CATEGORY_IMAGE_BUCKET).upload(
        path=storage_path,
        file=image_bytes,
        file_options={"content-type": "image/png", "upsert": "true"},
    )
    public_url = supabase.storage.from_(CATEGORY_IMAGE_BUCKET).get_public_url(storage_path)

    supabase.table("story_categories").update({"image_url": public_url}).eq("id", category_id).execute()

    return public_url
