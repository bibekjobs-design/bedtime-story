"""
Removes orphaned story audio files from the Supabase 'story-audio' bucket.
Orphan = a file in standard/ that no story_audio row points to AND is older
than DAYS days. Default is a DRY RUN (lists only). Add --delete to remove.
"""
import sys
from datetime import datetime, timedelta, timezone
sys.stdout.reconfigure(encoding="utf-8")
from app.db import get_supabase

DAYS = 5
BUCKET = "story-audio"
FOLDER = "standard"
do_delete = "--delete" in sys.argv

sb = get_supabase()

# every audio_url still in use
used = set()
start = 0
while True:
    rows = sb.table("story_audio").select("audio_url").range(start, start + 999).execute().data or []
    for r in rows:
        if r.get("audio_url"):
            used.add(r["audio_url"])
    if len(rows) < 1000:
        break
    start += 1000
used_text = "\n".join(used)

# every file in the folder
files = []
offset = 0
while True:
    page = sb.storage.from_(BUCKET).list(FOLDER, {"limit": 1000, "offset": offset}) or []
    files.extend(f for f in page if f.get("name") and f.get("id"))
    if len(page) < 1000:
        break
    offset += 1000

cutoff = datetime.now(timezone.utc) - timedelta(days=DAYS)
orphans, total_bytes = [], 0
for f in files:
    path = f"{FOLDER}/{f['name']}"
    created = datetime.fromisoformat(str(f.get("created_at", "")).replace("Z", "+00:00"))
    if created < cutoff and path not in used_text:
        size = (f.get("metadata") or {}).get("size", 0) or 0
        orphans.append(path)
        total_bytes += size

print(f"Files in {FOLDER}/: {len(files)}")
print(f"Orphans older than {DAYS} days: {len(orphans)}  (~{total_bytes/1048576:.0f} MB)")

if not do_delete:
    print("\nDRY RUN - nothing deleted. Run the DELETE .bat to remove them.")
else:
    for i in range(0, len(orphans), 100):
        sb.storage.from_(BUCKET).remove(orphans[i:i + 100])
    print(f"\nDeleted {len(orphans)} files.")
