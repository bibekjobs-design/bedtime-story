from app.db import get_supabase

def clean():
    sb = get_supabase()
    try:
        folders = sb.storage.from_("story-audio").list("story-images")
        for f in folders:
            name = f["name"]
            sub = sb.storage.from_("story-audio").list(f"story-images/{name}")
            paths = [f"story-images/{name}/{s['name']}" for s in sub]
            if paths:
                sb.storage.from_("story-audio").remove(paths)
                print("Cleaned:", paths)
    except Exception as e:
        print("Clean error:", e)

if __name__ == "__main__":
    clean()
