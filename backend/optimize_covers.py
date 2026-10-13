"""One-time: shrink the cover pictures already stored in Supabase.

  python optimize_covers.py            -> only LISTS every cover and its size (changes nothing)
  python optimize_covers.py --apply    -> shrinks big covers to ~1000px JPEG and updates the links
"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
import time
import httpx
from app.db import get_supabase
from app.services.story_service import _optimize_cover

APPLY = "--apply" in sys.argv
BIG = 250 * 1024  # covers above 250 KB get shrunk

sb = get_supabase()
rows = sb.table("story_texts").select("id, title, cover_image_url").not_.is_("cover_image_url", "null").execute().data
print(f"Stories with a cover picture: {len(rows)}\n")
total_before = total_after = 0
for r in rows:
    url = (r.get("cover_image_url") or "").strip()
    if not url.startswith("http"):
        continue
    try:
        data = httpx.get(url, timeout=60, follow_redirects=True).content
    except Exception as e:
        print(f"  ! {r['title'][:40]}: cannot download ({e})")
        continue
    kb = len(data) / 1024
    total_before += len(data)
    flag = "BIG" if len(data) > BIG else "ok "
    print(f"  [{flag}] {kb:8.0f} KB  {r['title'][:50]}")
    if not (APPLY and len(data) > BIG):
        total_after += len(data)
        continue
    small, mime, ext = _optimize_cover(data, "image/png" if url.split("?")[0].lower().endswith(".png") else "image/jpeg")
    path = f"{r['id']}.{ext}"
    sb.storage.from_("story-covers").upload(path=path, file=small, file_options={"content-type": mime, "upsert": "true", "cache-control": "31536000"})
    new_url = sb.storage.from_("story-covers").get_public_url(path).split("?")[0] + f"?v={int(time.time())}"
    sb.table("story_texts").update({"cover_image_url": new_url}).eq("id", r["id"]).execute()
    old_path = url.split("/story-covers/", 1)[-1].split("?")[0]
    if old_path != path:
        try:
            sb.storage.from_("story-covers").remove([old_path])
        except Exception:
            pass
    total_after += len(small)
    print(f"        -> now {len(small)/1024:.0f} KB")
print(f"\nTotal before: {total_before/1048576:.1f} MB")
if APPLY:
    print(f"Total after:  {total_after/1048576:.1f} MB")
else:
    print("Nothing changed. To shrink the BIG ones, run with --apply (OPTIMIZE_COVERS_APPLY.bat).")
