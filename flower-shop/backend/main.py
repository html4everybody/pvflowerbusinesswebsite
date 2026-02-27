from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import uuid
import os
from dotenv import load_dotenv
from supabase import create_client, Client
import bcrypt

load_dotenv()

app = FastAPI(title="FloranFlowers API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Supabase client ────────────────────────────────────────────────────────────
supabase: Client = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_KEY")
)

# ── Password helpers ───────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

# ── In-memory token store ──────────────────────────────────────────────────────
tokens: dict = {}

# ── Products (in-memory) ───────────────────────────────────────────────────────
PRODUCTS = [
    {"id": 1, "name": "Red Rose Bouquet", "description": "A stunning arrangement of 12 premium red roses, perfect for expressing love and romance.", "price": 49.99, "image": "https://res.cloudinary.com/duf4t01vy/image/upload/v1771819102/ChatGPT_Image_Feb_22_2026_10_57_56_PM_nxsgri.png", "category": "Garlands", "inStock": True},
    {"id": 2, "name": "Sunflower Delight", "description": "Bright and cheerful sunflowers that bring warmth and happiness to any space.", "price": 34.99, "image": "https://res.cloudinary.com/duf4t01vy/image/upload/v1771818621/ChatGPT_Image_Feb_22_2026_10_49_55_PM_zopiuw.png", "category": "Garlands", "inStock": True},
    {"id": 3, "name": "Elegant Lily Collection", "description": "Pure white lilies symbolizing elegance and sophistication.", "price": 54.99, "image": "https://res.cloudinary.com/duf4t01vy/image/upload/v1771819265/ChatGPT_Image_Feb_22_2026_11_00_56_PM_vrgztm.png", "category": "Garlands", "inStock": True},
    {"id": 4, "name": "Mixed Spring Bouquet", "description": "A colorful mix of seasonal spring flowers including tulips, daisies, and carnations.", "price": 39.99, "image": "https://res.cloudinary.com/duf4t01vy/image/upload/v1771819326/ChatGPT_Image_Feb_22_2026_11_01_54_PM_ehrqxd.png", "category": "Garlands", "inStock": True},
    {"id": 5, "name": "Pink Peony Paradise", "description": "Lush pink peonies that exude romance and charm.", "price": 64.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Flowers", "inStock": True},
    {"id": 6, "name": "Orchid Elegance", "description": "Exotic orchids that add a touch of luxury to any setting.", "price": 79.99, "image": "https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=400", "category": "Flowers", "inStock": True},
    {"id": 7, "name": "Lavender Dreams", "description": "Fragrant lavender bundles perfect for relaxation and home decor.", "price": 29.99, "image": "https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=400", "category": "Flowers", "inStock": True},
    {"id": 8, "name": "Tropical Paradise", "description": "Exotic tropical flowers including birds of paradise and hibiscus.", "price": 69.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Flowers", "inStock": True},
    {"id": 9, "name": "White Rose Serenity", "description": "Pure white roses symbolizing peace, purity, and new beginnings.", "price": 44.99, "image": "https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=400", "category": "Bouquets", "inStock": True},
    {"id": 10, "name": "Tulip Festival", "description": "Vibrant tulips in assorted colors celebrating the beauty of spring.", "price": 36.99, "image": "https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400", "category": "Flowers", "inStock": True},
    {"id": 11, "name": "Carnation Charm", "description": "Long-lasting carnations in beautiful shades of pink and red.", "price": 27.99, "image": "https://images.unsplash.com/photo-1526047932273-341f2a7631f9?w=400", "category": "Flowers", "inStock": True},
    {"id": 12, "name": "Premium Flower Box", "description": "Luxury arrangement in an elegant gift box, perfect for special occasions.", "price": 89.99, "image": "https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=400", "category": "Gifts", "inStock": True},
    {"id": 13, "name": "Yellow Rose Sunshine", "description": "Bright yellow roses representing friendship and joy.", "price": 42.99, "image": "https://images.unsplash.com/photo-1455659817273-f96807779a8a?w=400", "category": "Flowers", "inStock": True},
    {"id": 14, "name": "Daisy Meadow", "description": "Fresh white daisies bringing simplicity and charm.", "price": 24.99, "image": "https://images.unsplash.com/photo-1606041008023-472dfb5e530f?w=400", "category": "Flowers", "inStock": True},
    {"id": 15, "name": "Hydrangea Heaven", "description": "Beautiful blue hydrangeas perfect for home decoration.", "price": 52.99, "image": "https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=400", "category": "Flowers", "inStock": True},
    {"id": 16, "name": "Cherry Blossom Branch", "description": "Delicate cherry blossoms symbolizing renewal and hope.", "price": 47.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Bouquets", "inStock": True},
    {"id": 17, "name": "Gerbera Fiesta", "description": "Colorful gerbera daisies bringing vibrant energy to any room.", "price": 32.99, "image": "https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=400", "category": "Flowers", "inStock": True},
    {"id": 18, "name": "Calla Lily Grace", "description": "Elegant calla lilies for sophisticated arrangements.", "price": 58.99, "image": "https://images.unsplash.com/photo-1606041008023-472dfb5e530f?w=400", "category": "Flowers", "inStock": True},
    {"id": 19, "name": "Wildflower Mix", "description": "Natural wildflower bouquet with rustic charm.", "price": 35.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Bouquets", "inStock": True},
    {"id": 20, "name": "Ranunculus Delight", "description": "Layered ranunculus blooms in soft pastel colors.", "price": 45.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Flowers", "inStock": True},
    {"id": 21, "name": "Purple Iris Elegance", "description": "Stunning purple irises with elegant form.", "price": 38.99, "image": "https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=400", "category": "Flowers", "inStock": True},
    {"id": 22, "name": "Protea Exotic", "description": "Unique South African protea flowers.", "price": 72.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Flowers", "inStock": True},
    {"id": 23, "name": "Dahlia Dreams", "description": "Gorgeous dahlias in rich autumn colors.", "price": 48.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Flowers", "inStock": True},
    {"id": 24, "name": "Anemone Beauty", "description": "Delicate anemones with striking dark centers.", "price": 41.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Flowers", "inStock": True},
    {"id": 25, "name": "Chrysanthemum Burst", "description": "Full chrysanthemum blooms in various colors.", "price": 33.99, "image": "https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=400", "category": "Garlands", "inStock": True},
    {"id": 26, "name": "Freesia Fragrance", "description": "Sweetly scented freesias in soft hues.", "price": 36.99, "image": "https://images.unsplash.com/photo-1606041008023-472dfb5e530f?w=400", "category": "Flowers", "inStock": True},
    {"id": 27, "name": "Amaryllis Red", "description": "Bold red amaryllis for dramatic displays.", "price": 55.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Flowers", "inStock": True},
    {"id": 28, "name": "Sweet Pea Garden", "description": "Delicate sweet peas with lovely fragrance.", "price": 31.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Flowers", "inStock": True},
    {"id": 29, "name": "Magnolia Majesty", "description": "Elegant magnolia branches for statement arrangements.", "price": 67.99, "image": "https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=400", "category": "Flowers", "inStock": True},
    {"id": 30, "name": "Jasmine Bliss", "description": "Fragrant jasmine for romantic occasions.", "price": 43.99, "image": "https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=400", "category": "Garlands", "inStock": True},
    {"id": 31, "name": "Gardenia Perfection", "description": "Creamy gardenias with intoxicating scent.", "price": 59.99, "image": "https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=400", "category": "Flowers", "inStock": True},
    {"id": 32, "name": "Zinnia Carnival", "description": "Bright zinnias in rainbow colors.", "price": 28.99, "image": "https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=400", "category": "Flowers", "inStock": True},
    {"id": 33, "name": "Cosmos Cloud", "description": "Airy cosmos flowers in pink and white.", "price": 26.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Garlands", "inStock": True},
    {"id": 34, "name": "Snapdragon Tower", "description": "Vertical snapdragons adding height to arrangements.", "price": 34.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Flowers", "inStock": True},
    {"id": 35, "name": "Petunia Paradise", "description": "Cascading petunias in vibrant shades.", "price": 23.99, "image": "https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=400", "category": "Flowers", "inStock": True},
    {"id": 36, "name": "Marigold Gold", "description": "Traditional marigolds in sunny yellow and orange, ideal for garlands.", "price": 22.99, "image": "https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=400", "category": "Garlands", "inStock": True},
    {"id": 37, "name": "Aster Autumn", "description": "Purple asters perfect for fall garlands and arrangements.", "price": 29.99, "image": "https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=400", "category": "Garlands", "inStock": True},
    {"id": 38, "name": "Delphinium Blue", "description": "Tall blue delphiniums for dramatic effect.", "price": 46.99, "image": "https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=400", "category": "Flowers", "inStock": True},
    {"id": 39, "name": "Stock Fragrant", "description": "Sweetly scented stock in pastel shades.", "price": 37.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Flowers", "inStock": True},
    {"id": 40, "name": "Lisianthus Luxury", "description": "Rose-like lisianthus in soft colors.", "price": 51.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Flowers", "inStock": True},
    {"id": 41, "name": "Eucalyptus Seeded", "description": "Fresh eucalyptus for greenery arrangements.", "price": 19.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Decoration", "inStock": True},
    {"id": 42, "name": "Baby Breath Cloud", "description": "Delicate baby breath for filler or solo arrangements.", "price": 18.99, "image": "https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=400", "category": "Decoration", "inStock": True},
    {"id": 43, "name": "Fern Forest", "description": "Lush fern fronds for natural arrangements.", "price": 21.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Decoration", "inStock": True},
    {"id": 44, "name": "Dusty Miller", "description": "Silver-grey dusty miller for texture.", "price": 17.99, "image": "https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=400", "category": "Decoration", "inStock": True},
    {"id": 45, "name": "Olive Branch", "description": "Mediterranean olive branches for rustic style.", "price": 25.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Decoration", "inStock": True},
    {"id": 46, "name": "Pink Rose Garden", "description": "Soft pink roses for romantic gestures.", "price": 47.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Flowers", "inStock": True},
    {"id": 47, "name": "Orange Rose Sunset", "description": "Warm orange roses for vibrant arrangements.", "price": 45.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Flowers", "inStock": True},
    {"id": 48, "name": "Peach Rose Blush", "description": "Delicate peach roses for elegant occasions.", "price": 48.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Flowers", "inStock": True},
    {"id": 49, "name": "Coral Rose Joy", "description": "Cheerful coral roses for celebrations.", "price": 46.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Flowers", "inStock": True},
    {"id": 50, "name": "Lavender Rose Dream", "description": "Unique lavender roses for special moments.", "price": 52.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Flowers", "inStock": True},
    {"id": 51, "name": "Mini Sunflower Bunch", "description": "Petite sunflowers for compact arrangements.", "price": 28.99, "image": "https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=400", "category": "Flowers", "inStock": True},
    {"id": 52, "name": "Giant Sunflower Single", "description": "Statement single giant sunflower.", "price": 15.99, "image": "https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=400", "category": "Flowers", "inStock": True},
    {"id": 53, "name": "Stargazer Lily", "description": "Fragrant stargazer lilies in pink.", "price": 56.99, "image": "https://images.unsplash.com/photo-1606041008023-472dfb5e530f?w=400", "category": "Flowers", "inStock": True},
    {"id": 54, "name": "Tiger Lily Wild", "description": "Spotted tiger lilies for exotic flair.", "price": 49.99, "image": "https://images.unsplash.com/photo-1606041008023-472dfb5e530f?w=400", "category": "Flowers", "inStock": True},
    {"id": 55, "name": "Asiatic Lily Mix", "description": "Colorful asiatic lilies in mixed hues.", "price": 44.99, "image": "https://images.unsplash.com/photo-1606041008023-472dfb5e530f?w=400", "category": "Flowers", "inStock": True},
    {"id": 56, "name": "Red Tulip Romance", "description": "Classic red tulips for love.", "price": 34.99, "image": "https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400", "category": "Flowers", "inStock": True},
    {"id": 57, "name": "Yellow Tulip Sunshine", "description": "Bright yellow tulips for happiness.", "price": 32.99, "image": "https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400", "category": "Flowers", "inStock": True},
    {"id": 58, "name": "Purple Tulip Royal", "description": "Regal purple tulips for elegance.", "price": 35.99, "image": "https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400", "category": "Flowers", "inStock": True},
    {"id": 59, "name": "White Tulip Pure", "description": "Pure white tulips for simplicity.", "price": 33.99, "image": "https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400", "category": "Flowers", "inStock": True},
    {"id": 60, "name": "Parrot Tulip Fancy", "description": "Frilly parrot tulips in mixed colors.", "price": 39.99, "image": "https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400", "category": "Flowers", "inStock": True},
    {"id": 61, "name": "White Carnation Pure", "description": "Classic white carnations for any occasion.", "price": 24.99, "image": "https://images.unsplash.com/photo-1526047932273-341f2a7631f9?w=400", "category": "Flowers", "inStock": True},
    {"id": 62, "name": "Red Carnation Love", "description": "Deep red carnations expressing love.", "price": 26.99, "image": "https://images.unsplash.com/photo-1526047932273-341f2a7631f9?w=400", "category": "Flowers", "inStock": True},
    {"id": 63, "name": "Pink Carnation Sweet", "description": "Sweet pink carnations for gratitude.", "price": 25.99, "image": "https://images.unsplash.com/photo-1526047932273-341f2a7631f9?w=400", "category": "Flowers", "inStock": True},
    {"id": 64, "name": "White Peony Bride", "description": "Bridal white peonies for weddings.", "price": 69.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Flowers", "inStock": True},
    {"id": 65, "name": "Blush Peony Romance", "description": "Soft blush peonies for romance.", "price": 66.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Flowers", "inStock": True},
    {"id": 66, "name": "Coral Peony Joy", "description": "Vibrant coral peonies for celebrations.", "price": 67.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Flowers", "inStock": True},
    {"id": 67, "name": "White Orchid Zen", "description": "Peaceful white orchids for tranquility.", "price": 74.99, "image": "https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=400", "category": "Flowers", "inStock": True},
    {"id": 68, "name": "Purple Orchid Royal", "description": "Majestic purple orchids for luxury.", "price": 82.99, "image": "https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=400", "category": "Flowers", "inStock": True},
    {"id": 69, "name": "Yellow Orchid Exotic", "description": "Sunny yellow orchids for brightness.", "price": 77.99, "image": "https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=400", "category": "Flowers", "inStock": True},
    {"id": 70, "name": "Mixed Orchid Pot", "description": "Potted orchid mix for lasting beauty.", "price": 89.99, "image": "https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=400", "category": "Bouquets", "inStock": True},
    {"id": 71, "name": "Bird of Paradise", "description": "Striking bird of paradise flowers.", "price": 62.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Flowers", "inStock": True},
    {"id": 72, "name": "Anthurium Red", "description": "Glossy red anthuriums for modern style.", "price": 54.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Flowers", "inStock": True},
    {"id": 73, "name": "Heliconia Exotic", "description": "Dramatic heliconia for tropical vibes.", "price": 58.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Flowers", "inStock": True},
    {"id": 74, "name": "Ginger Flower", "description": "Unique ginger flowers for exotic arrangements.", "price": 49.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Flowers", "inStock": True},
    {"id": 75, "name": "Plumeria Hawaiian", "description": "Fragrant Hawaiian plumeria flowers.", "price": 44.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Flowers", "inStock": True},
    {"id": 76, "name": "Birthday Celebration Box", "description": "Festive arrangement for birthdays.", "price": 79.99, "image": "https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=400", "category": "Gifts", "inStock": True},
    {"id": 77, "name": "Anniversary Deluxe", "description": "Romantic arrangement for anniversaries.", "price": 99.99, "image": "https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=400", "category": "Gifts", "inStock": True},
    {"id": 78, "name": "Get Well Wishes", "description": "Cheerful bouquet for recovery wishes.", "price": 54.99, "image": "https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=400", "category": "Bouquets", "inStock": True},
    {"id": 79, "name": "Sympathy White", "description": "Respectful white arrangement for sympathy.", "price": 74.99, "image": "https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=400", "category": "Gifts", "inStock": True},
    {"id": 80, "name": "Congratulations Burst", "description": "Celebratory arrangement for achievements.", "price": 64.99, "image": "https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=400", "category": "Bouquets", "inStock": True},
    {"id": 81, "name": "Thank You Bouquet", "description": "Grateful arrangement to say thanks.", "price": 49.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Bouquets", "inStock": True},
    {"id": 82, "name": "New Baby Pink", "description": "Soft pink flowers for baby girl.", "price": 56.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Gifts", "inStock": True},
    {"id": 83, "name": "New Baby Blue", "description": "Gentle blue flowers for baby boy.", "price": 56.99, "image": "https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=400", "category": "Gifts", "inStock": True},
    {"id": 84, "name": "Mothers Day Special", "description": "Special arrangement for mothers.", "price": 69.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Gifts", "inStock": True},
    {"id": 85, "name": "Valentine Romance", "description": "Romantic red roses for Valentine.", "price": 79.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Gifts", "inStock": True},
    {"id": 86, "name": "Christmas Joy", "description": "Festive holiday arrangement.", "price": 72.99, "image": "https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=400", "category": "Gifts", "inStock": True},
    {"id": 87, "name": "Easter Spring", "description": "Fresh spring arrangement for Easter.", "price": 54.99, "image": "https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400", "category": "Gifts", "inStock": True},
    {"id": 88, "name": "Thanksgiving Harvest", "description": "Autumn harvest arrangement.", "price": 64.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Gifts", "inStock": True},
    {"id": 89, "name": "Succulent Garden", "description": "Long-lasting succulent arrangement.", "price": 42.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Decoration", "inStock": True},
    {"id": 90, "name": "Potted Peace Lily", "description": "Air-purifying peace lily plant.", "price": 39.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Decoration", "inStock": True},
    {"id": 91, "name": "Mini Rose Plant", "description": "Potted miniature rose plant.", "price": 34.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Decoration", "inStock": True},
    {"id": 92, "name": "Herb Garden Kit", "description": "Fresh herb plants for cooking.", "price": 29.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Decoration", "inStock": True},
    {"id": 93, "name": "Bonsai Tree", "description": "Artistic bonsai tree for decor.", "price": 89.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Decoration", "inStock": True},
    {"id": 94, "name": "Wedding Bridal Bouquet", "description": "Elegant bridal bouquet for weddings.", "price": 149.99, "image": "https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=400", "category": "Bouquets", "inStock": True},
    {"id": 95, "name": "Bridesmaid Bouquet", "description": "Coordinating bridesmaid bouquet.", "price": 69.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Bouquets", "inStock": True},
    {"id": 96, "name": "Boutonniere Classic", "description": "Classic boutonniere for groom.", "price": 19.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Garlands", "inStock": True},
    {"id": 97, "name": "Corsage Elegant", "description": "Elegant wrist corsage.", "price": 29.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Garlands", "inStock": True},
    {"id": 98, "name": "Centerpiece Grand", "description": "Grand table centerpiece.", "price": 119.99, "image": "https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=400", "category": "Decoration", "inStock": True},
    {"id": 99, "name": "Flower Crown", "description": "Bohemian flower crown for events.", "price": 44.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Garlands", "inStock": True},
    {"id": 100, "name": "Dried Flower Bundle", "description": "Long-lasting dried flower arrangement.", "price": 38.99, "image": "https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=400", "category": "Decoration", "inStock": True},
]

# ── Pydantic Models ────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: str
    password: str

class RegisterRequest(BaseModel):
    firstName: str
    lastName: str
    email: str
    password: str

class ContactRequest(BaseModel):
    name: str
    email: str
    phone: str
    subject: str
    message: str

class OrderItem(BaseModel):
    productId: int
    name: str
    price: float
    quantity: int

class OrderRequest(BaseModel):
    items: list[OrderItem]
    total: float
    customer: dict
    delivery_type: Optional[str] = "immediate"
    delivery_datetime: Optional[str] = None

class UpdateDeliveryRequest(BaseModel):
    delivery_type: str
    delivery_datetime: Optional[str] = None

class CartItemRequest(BaseModel):
    user_id: str
    product_id: int
    quantity: int

# ── Products Routes ────────────────────────────────────────────────────────────

@app.get("/api/products")
def get_products(category: Optional[str] = None):
    if category:
        return [p for p in PRODUCTS if p["category"] == category]
    return PRODUCTS

@app.get("/api/products/categories")
def get_categories():
    return sorted(list(set(p["category"] for p in PRODUCTS)))

@app.get("/api/products/{product_id}")
def get_product(product_id: int):
    product = next((p for p in PRODUCTS if p["id"] == product_id), None)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product

# ── Auth Routes ────────────────────────────────────────────────────────────────

@app.post("/api/auth/register")
def register(req: RegisterRequest):
    existing = supabase.table("users").select("email").eq("email", req.email).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Email already registered")

    hashed_password = hash_password(req.password)

    result = supabase.table("users").insert({
        "email": req.email,
        "password": hashed_password,
        "first_name": req.firstName,
        "last_name": req.lastName
    }).execute()

    user = result.data[0]
    token = str(uuid.uuid4())
    tokens[token] = req.email

    return {
        "token": token,
        "user": {
            "id": user["id"],
            "firstName": user["first_name"],
            "lastName": user["last_name"],
            "email": user["email"]
        }
    }

@app.post("/api/auth/login")
def login(req: LoginRequest):
    result = supabase.table("users").select("*").eq("email", req.email).execute()
    if not result.data:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user = result.data[0]
    if not verify_password(req.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = str(uuid.uuid4())
    tokens[token] = req.email

    return {
        "token": token,
        "user": {
            "id": user["id"],
            "firstName": user["first_name"],
            "lastName": user["last_name"],
            "email": user["email"]
        }
    }

# ── Contact Route ──────────────────────────────────────────────────────────────

@app.post("/api/contact")
def submit_contact(req: ContactRequest):
    supabase.table("contacts").insert({
        "name": req.name,
        "email": req.email,
        "phone": req.phone,
        "subject": req.subject,
        "message": req.message
    }).execute()
    return {"message": "Message received successfully"}

# ── Cart Routes ────────────────────────────────────────────────────────────────

@app.get("/api/cart")
def get_cart(user_id: str):
    result = supabase.table("cart_items").select("*").eq("user_id", user_id).execute()
    cart = []
    for item in result.data:
        product = next((p for p in PRODUCTS if p["id"] == item["product_id"]), None)
        if product:
            cart.append({"product": product, "quantity": item["quantity"]})
    return cart

@app.post("/api/cart/item")
def upsert_cart_item(req: CartItemRequest):
    existing = supabase.table("cart_items").select("*").eq("user_id", req.user_id).eq("product_id", req.product_id).execute()
    if existing.data:
        supabase.table("cart_items").update({"quantity": req.quantity}).eq("user_id", req.user_id).eq("product_id", req.product_id).execute()
    else:
        supabase.table("cart_items").insert({"user_id": req.user_id, "product_id": req.product_id, "quantity": req.quantity}).execute()
    return {"status": "ok"}

@app.delete("/api/cart/item/{product_id}")
def remove_cart_item(product_id: int, user_id: str):
    supabase.table("cart_items").delete().eq("user_id", user_id).eq("product_id", product_id).execute()
    return {"status": "ok"}

@app.delete("/api/cart/clear")
def clear_cart(user_id: str):
    supabase.table("cart_items").delete().eq("user_id", user_id).execute()
    return {"status": "ok"}

# ── Orders Route ───────────────────────────────────────────────────────────────

@app.get("/api/orders")
def get_user_orders(email: str):
    orders_result = supabase.table("orders").select("*").eq("customer_email", email).order("created_at", desc=True).execute()
    orders = orders_result.data
    if not orders:
        return []
    order_ids = [o["id"] for o in orders]
    items_result = supabase.table("order_items").select("*").in_("order_id", order_ids).execute()
    items_by_order: dict = {}
    for item in items_result.data:
        product = next((p for p in PRODUCTS if p["id"] == item["product_id"]), None)
        item["image"] = product["image"] if product else ""
        items_by_order.setdefault(item["order_id"], []).append(item)
    for order in orders:
        order["items"] = items_by_order.get(order["id"], [])
    return orders

@app.patch("/api/orders/{order_id}/delivery")
def update_delivery(order_id: str, req: UpdateDeliveryRequest):
    result = supabase.table("orders").select("status").eq("id", order_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Order not found")
    if result.data[0]["status"] == "cancelled":
        raise HTTPException(status_code=400, detail="Cannot update delivery for a cancelled order")
    supabase.table("orders").update({
        "delivery_type": req.delivery_type,
        "delivery_datetime": req.delivery_datetime
    }).eq("id", order_id).execute()
    return {"status": "updated"}

@app.patch("/api/orders/{order_id}/cancel")
def cancel_order(order_id: str):
    result = supabase.table("orders").select("status").eq("id", order_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Order not found")
    if result.data[0]["status"] != "confirmed":
        raise HTTPException(status_code=400, detail="Only confirmed orders can be cancelled")
    supabase.table("orders").update({"status": "cancelled"}).eq("id", order_id).execute()
    return {"status": "cancelled"}

@app.post("/api/orders")
def create_order(req: OrderRequest):
    order_id = "FLR" + str(uuid.uuid4())[:8].upper()

    supabase.table("orders").insert({
        "id": order_id,
        "customer_email": req.customer.get("email", ""),
        "customer_name": req.customer.get("name", ""),
        "total": req.total,
        "status": "confirmed",
        "delivery_type": req.delivery_type,
        "delivery_datetime": req.delivery_datetime
    }).execute()

    if req.items:
        supabase.table("order_items").insert([
            {
                "order_id": order_id,
                "product_id": item.productId,
                "name": item.name,
                "price": item.price,
                "quantity": item.quantity
            }
            for item in req.items
        ]).execute()

    return {"orderId": order_id, "status": "confirmed"}
