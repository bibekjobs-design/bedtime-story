import sys
sys.stdout.reconfigure(encoding='utf-8')
from app.db import get_supabase

sb = get_supabase()

# Pre-crafted high quality soothing bedtime stories per theme
STORIES_SEED_DATA = {
    "Bedtime": [
        ("The Moon's Cozy Pajamas", "A sleepy little crescent moon puts on fluffy cloud pajamas and snuggles into the starry sky."),
        ("The Little Star that Yawned", "High above the quiet world, a tiny golden star stretches its sleepy rays and drifts into a peaceful nap."),
        ("The Warm Blanket of Whispering Clouds", "Soft, gentle night clouds wrap the slumbering hills in a warm, misty blanket of dreams."),
        ("The Sleepy River's Lullaby", "A gentle, crystal river hums a quiet bedtime melody to rock all the little stones to sleep."),
    ],
    "Animals": [
        ("Barnaby Bear's Honey Dream", "A gentle little bear cuddles into his cozy moss den after a sweet afternoon of berry picking."),
        ("The Sleepy Sea Otter's Floating Bed", "A calm baby otter drifts atop gentle ocean ripples wrapped in soft kelp blankets under the moonlight."),
        ("Oliver Owl's Starlit Roost", "A kind little owl perches in a hollow oak tree, watching the peaceful stars twinkle over the forest."),
        ("The Bunny's Soft Burrow Lullaby", "Three fluffy bunnies snuggle close in their warm underground burrow listening to the distant rain."),
    ],
    "Magic Forest": [
        ("The Glowing Mushroom Grove", "Gentle bioluminescent mushrooms glow with a warm amber light, guiding the sleepy fairies to bed."),
        ("The Whispering Willow's Soft Song", "An ancient willow tree sways gently in the evening breeze, whispering soothing lullabies."),
        ("The Secret Starlight Glade", "A quiet meadow where fireflies leave trails of stardust on sleepy flower petals."),
        ("The Mossy Hollow Nap", "A velvet bed of soft green moss where the gentle forest creatures rest until morning."),
    ],
    "Space": [
        ("Oliver the Cozy Comet", "A fluffy, slow-moving comet sweeps a path of warm glittering stardust across the tranquil sky."),
        ("The Sleepy Star of the Blue Nebula", "A tiny star sparkles with soft indigo light, humming a celestial lullaby for the cosmos."),
        ("The Orbiting Cloud Carousel", "Gentle planetary rings rotate slowly like a bedtime carousel carrying sleepy dreamers."),
        ("The Moonlit Asteroid Rest", "A quiet, round asteroid floats peacefully through a sea of sparkling stardust."),
    ],
    "Ocean": [
        ("The Gentle Wave Lullaby", "Rhythmic ocean swells wash gently against warm sandy shores under a silver moon."),
        ("The Sleepy Blue Dolphin's Glide", "A friendly young dolphin glides through tranquil turquoise waters beneath a canopy of stars."),
        ("The Starfish Bed of Coral", "A little orange starfish rests upon a soft coral pillow in the quiet depths of the sea."),
        ("The Singing Shell of the Lagoon", "A magical spiral seashell echoes the soothing melody of the deep, calm tide."),
    ],
    "Dinosaurs": [
        ("Barnaby Brontosaurus and the Moonlit Marsh", "A gentle, tall dinosaur dips his head beneath the leafy ferns for a deep, peaceful sleep."),
        ("The Stegosaurus Who Counted Clouds", "A sleepy little stegosaurus watches fluffy cloud-puffs drift past the moon."),
        ("Tilly Triceratops' Starry Bed", "A friendly baby triceratops snuggles into a pile of warm palm leaves as the jungle sleeps."),
        ("Pip the Pterodactyl's Quiet Glide", "A tiny pterodactyl folds its soft wings and rests atop a misty mountain peak."),
    ],
    "Fairy Tales & Fantasy": [
        ("The Princess's Cloud Castle", "In a palace built of fluffy cotton-candy clouds, a sleepy princess listens to harp lullabies."),
        ("The Dragon's Warm Hearth Nap", "A friendly little dragon curls around a cozy ember, breathing warm, gentle snores into the night."),
        ("The Magic Wand that Made Dreams", "A glittering silver wand sprinkles sleepy dream-dust over every cozy pillow in the kingdom."),
        ("The Enchanted Garden of Slumber", "Moonflowers open their silver petals, releasing a soft fragrance of lavender and peace."),
    ],
    "Friendship": [
        ("The Moon and the Little Kite", "A paper kite rests gently in the branches, sharing quiet bedtime secrets with the silver moon."),
        ("Barnaby Bear's Shared Blanket", "Barnaby and his best rabbit friend share a warm quilt under the canopy of whispering pine trees."),
        ("The Two Sleepy Fireflies", "Two tiny firefly friends glow together in sync before tucking their wings for the night."),
        ("The Campfire Tale Under the Stars", "Friendly woodland friends gather around a soft, glowing campfire listening to peaceful tales."),
    ],
    "Adventure": [
        ("The Sleepy Safari Starry Night", "Across the golden savanna, baby giraffes and gentle elephants settle beneath a sky full of diamonds."),
        ("The Mountain of Floating Dreams", "A tranquil hot-air balloon floats gently over quiet misty mountain peaks into dreamland."),
        ("The Secret Island of Calm", "A hidden, sun-warmed island where the only sound is the rhythmic lap of calm waves."),
        ("The Starship's Quiet Journey Home", "A peaceful bedtime rocket glides on autopilot through soft cosmic ribbons toward home."),
    ]
}

cats = sb.table('story_categories').select('*').execute().data
ages = sb.table('age_groups').select('*').execute().data

print(f"Found {len(cats)} categories in database.")

inserted_count = 0
for c in cats:
    cat_id = c["id"]
    cat_name = c["name"]

    # Match category name or fallback
    matching_key = None
    for k in STORIES_SEED_DATA:
        if k.lower() in cat_name.lower() or cat_name.lower() in k.lower():
            matching_key = k
            break
    if not matching_key:
        matching_key = "Bedtime"

    stories_to_seed = STORIES_SEED_DATA[matching_key]

    for a in ages:
        age_id = a["id"]
        # Check existing count
        existing = sb.table("story_texts").select("id").eq("category_id", cat_id).eq("age_group_id", age_id).execute().data
        if len(existing) < 4:
            needed = 4 - len(existing)
            for title, teaser in stories_to_seed[:needed]:
                payload = {
                    "category_id": cat_id,
                    "age_group_id": age_id,
                    "language_id": 1,
                    "title": title,
                    "teaser": teaser,
                    "generation_status": "teaser_only",
                    "safety_check_status": "passed",
                    "times_served": 10
                }
                sb.table("story_texts").insert(payload).execute()
                inserted_count += 1
                print(f"  + Seeded '{title}' into '{cat_name}' (Age {age_id})")

print(f"\nDone! Seeded {inserted_count} stories across all categories & age groups.")
