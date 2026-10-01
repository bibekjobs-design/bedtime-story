import sys
sys.stdout.reconfigure(encoding='utf-8')
from app.db import get_supabase

sb = get_supabase()
cats = sb.table('story_categories').select('*').execute().data
ages = sb.table('age_groups').select('*').execute().data

print("CATEGORIES IN DATABASE:")
for c in cats:
    print(f"- ID: {c['id']}, Name: {c['name']}, Icon: {c.get('icon', '')}")

print("\nAGE GROUPS:")
for a in ages:
    print(f"- ID: {a['id']}, Label: {a['label']}")

stories = sb.table('story_texts').select('id, category_id, age_group_id, title').execute().data
print(f"\nTOTAL STORIES IN DB: {len(stories)}")
for c in cats:
    c_stories = [s for s in stories if s.get('category_id') == c['id']]
    print(f"Category '{c['name']}': {len(c_stories)} stories")
