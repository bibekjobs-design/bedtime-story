"""
One-off data update (no schema change): widens age_group id=3 from
'8-10' (max_age 10) to '8-15' (max_age 15), so the app's oldest content
bucket honestly covers the new 15-year-old ceiling the Add Child Profile
screen now offers. This only updates the row's label/max_age - it does
NOT touch category_age_groups or story_texts, which keep working exactly
as before (they're linked by age_group_id=3, unaffected by the label).
"""
from app.db import get_supabase

supabase = get_supabase()

before = supabase.table("age_groups").select("*").eq("id", 3).single().execute().data
print(f"Before: {before}")

res = supabase.table("age_groups").update({
    "label": "8-15",
    "max_age": 15,
}).eq("id", 3).execute()

after = res.data[0] if res.data else None
print(f"After:  {after}")
print()
print("===== DONE - you can close this window now =====")
