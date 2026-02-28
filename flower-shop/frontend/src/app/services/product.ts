import { Injectable } from '@angular/core';
import { Product } from '../models/product.model';

@Injectable({
  providedIn: 'root'
})
export class ProductService {
  private products: Product[] = [
    { id: 1, name: 'Red Rose Bouquet', description: 'A stunning arrangement of 12 premium red roses, perfect for expressing love and romance.', price: 49.99, image: 'https://lh3.googleusercontent.com/d/1nuxA-51JnSE98viN19Eeo-p3r2lemJMK', category: 'Garlands', inStock: true, rating: 4.8 },
    { id: 2, name: 'Sunflower Delight', description: 'Bright and cheerful sunflowers that bring warmth and happiness to any space.', price: 34.99, image: 'https://lh3.googleusercontent.com/d/1YAbDIsu4Wa9vvEfD8-0WYsZl-nPnDMFM', category: 'Garlands', inStock: true, rating: 4.6 },
    { id: 3, name: 'Elegant Lily Collection', description: 'Pure white lilies symbolizing elegance and sophistication.', price: 54.99, image: 'https://res.cloudinary.com/duf4t01vy/image/upload/v1771819265/ChatGPT_Image_Feb_22_2026_11_00_56_PM_vrgztm.png', category: 'Garlands', inStock: true, rating: 4.9 },
    { id: 4, name: 'Mixed Spring Bouquet', description: 'A colorful mix of seasonal spring flowers including tulips, daisies, and carnations.', price: 39.99, image: 'https://res.cloudinary.com/duf4t01vy/image/upload/v1771819326/ChatGPT_Image_Feb_22_2026_11_01_54_PM_ehrqxd.png', category: 'Garlands', inStock: true, rating: 4.7 },
    { id: 5, name: 'Pink Peony Paradise', description: 'Lush pink peonies that exude romance and charm.', price: 64.99, image: 'https://lh3.googleusercontent.com/d/1aUBQMONcLw9vUpgIq3Cn1nrt7gx6S7Xt', category: 'Flowers', inStock: true, rating: 4.9 },
    { id: 6, name: 'Orchid Elegance', description: 'Exotic orchids that add a touch of luxury to any setting.', price: 79.99, image: 'https://lh3.googleusercontent.com/d/1L9tTNl3wz5OA8S5SxK_UX4RZm3UrKoVa', category: 'Flowers', inStock: true, rating: 4.8 },
    { id: 7, name: 'Lavender Dreams', description: 'Fragrant lavender bundles perfect for relaxation and home decor.', price: 29.99, image: 'https://lh3.googleusercontent.com/d/1O973hjUx9g7fBAfO3vwaYgJLMngfXUUb', category: 'Flowers', inStock: true, rating: 4.5 },
    { id: 8, name: 'Tropical Paradise', description: 'Exotic tropical flowers including birds of paradise and hibiscus.', price: 69.99, image: 'https://lh3.googleusercontent.com/d/1wycY7Nfv1bTFnep4oE-q7i-KuQY4kxDH', category: 'Flowers', inStock: true, rating: 4.7 },
    { id: 9, name: 'White Rose Serenity', description: 'Pure white roses symbolizing peace, purity, and new beginnings.', price: 44.99, image: 'https://lh3.googleusercontent.com/d/1qSK5vtVSqWvqArOtC2WnioD65zga5G2g', category: 'Bouquets', inStock: true, rating: 4.8 },
    { id: 10, name: 'Tulip Festival', description: 'Vibrant tulips in assorted colors celebrating the beauty of spring.', price: 36.99, image: 'https://lh3.googleusercontent.com/d/1whAwsIb6EH3ELHMrPzK4NMxHu-Uk8fBC', category: 'Flowers', inStock: true, rating: 4.6 },
    { id: 11, name: 'Carnation Charm', description: 'Long-lasting carnations in beautiful shades of pink and red.', price: 27.99, image: 'https://lh3.googleusercontent.com/d/1F6DXXxmX-Ic68FMb-ulr0eqehefdbGCb', category: 'Flowers', inStock: true, rating: 4.4 },
    { id: 12, name: 'Premium Flower Box', description: 'Luxury arrangement in an elegant gift box, perfect for special occasions.', price: 89.99, image: 'https://lh3.googleusercontent.com/d/1gJ0Z4ZCnTTNCCdxkBi-FUyDaf_dU3L0G', category: 'Flower Braids', inStock: true, rating: 5.0 },
    { id: 13, name: 'Yellow Rose Sunshine', description: 'Bright yellow roses representing friendship and joy.', price: 42.99, image: 'https://lh3.googleusercontent.com/d/1dVJuWiCEhaRi1Z03vIa_j_lwuyvwRgzE', category: 'Flowers', inStock: true, rating: 4.7 },
    { id: 14, name: 'Daisy Meadow', description: 'Fresh white daisies bringing simplicity and charm.', price: 24.99, image: 'https://lh3.googleusercontent.com/d/1NKDpaB5vn2sU5oghj-mNZ4m3oq6QGRDA', category: 'Flowers', inStock: true, rating: 4.5 },
    { id: 15, name: 'Hydrangea Heaven', description: 'Beautiful blue hydrangeas perfect for home decoration.', price: 52.99, image: 'https://lh3.googleusercontent.com/d/1nl91VHvvqQ4iQ1_dNaZ1PzGv1yC_olaX', category: 'Flowers', inStock: true, rating: 4.8 },
    { id: 16, name: 'Cherry Blossom Branch', description: 'Delicate cherry blossoms symbolizing renewal and hope.', price: 47.99, image: 'https://lh3.googleusercontent.com/d/1bWDcV0Ur9OgOlTySRkO0jRI5MwwazyCj', category: 'Bouquets', inStock: true, rating: 4.9 },
    { id: 17, name: 'Gerbera Fiesta', description: 'Colorful gerbera daisies bringing vibrant energy to any room.', price: 32.99, image: 'https://lh3.googleusercontent.com/d/1s6PPA6yIV9l3wyUjuXfVfVdIJ4KtvBHY', category: 'Flowers', inStock: true, rating: 4.6 },
    { id: 18, name: 'Calla Lily Grace', description: 'Elegant calla lilies for sophisticated arrangements.', price: 58.99, image: 'https://lh3.googleusercontent.com/d/184PECfm3r3S8ylT6c6psfiNLV91htfrZ', category: 'Flowers', inStock: true, rating: 4.8 },
    { id: 19, name: 'Wildflower Mix', description: 'Natural wildflower bouquet with rustic charm.', price: 35.99, image: 'https://lh3.googleusercontent.com/d/1OELDWd5rM7l1Qg6V3QbcKCi4p4jkCWq0', category: 'Bouquets', inStock: true, rating: 4.5 },
    { id: 20, name: 'Ranunculus Delight', description: 'Layered ranunculus blooms in soft pastel colors.', price: 45.99, image: 'https://lh3.googleusercontent.com/d/1b-sslQXb0LFqPDB0Xc4luZyIFGe4sD0H', category: 'Flowers', inStock: true, rating: 4.7 },
    { id: 21, name: 'Purple Iris Elegance', description: 'Stunning purple irises with elegant form.', price: 38.99, image: 'https://lh3.googleusercontent.com/d/1EdlclfKfojhWqanF-TV_mPfh_ItEoWJr', category: 'Flowers', inStock: true, rating: 4.6 },
    { id: 22, name: 'Protea Exotic', description: 'Unique South African protea flowers.', price: 72.99, image: 'https://lh3.googleusercontent.com/d/1ZZDnW8v9TSCFsN-q8W6oP3PdqAQZExnz', category: 'Flowers', inStock: true, rating: 4.9 },
    { id: 23, name: 'Dahlia Dreams', description: 'Gorgeous dahlias in rich autumn colors.', price: 48.99, image: 'https://lh3.googleusercontent.com/d/10lBJASsDwGwu5jYkABlvsc1TcaP9yid7', category: 'Flowers', inStock: true, rating: 4.7 },
    { id: 24, name: 'Anemone Beauty', description: 'Delicate anemones with striking dark centers.', price: 41.99, image: 'https://lh3.googleusercontent.com/d/1rDUyqzjGNshdeQzyg0zqcqhDitbqR290', category: 'Flowers', inStock: true, rating: 4.6 },
    { id: 25, name: 'Chrysanthemum Burst', description: 'Full chrysanthemum blooms in various colors.', price: 33.99, image: 'https://lh3.googleusercontent.com/d/1ps20c7uqjovJqja2qA_OTY7EosTURU52', category: 'Garlands', inStock: true, rating: 4.5 },
    { id: 26, name: 'Freesia Fragrance', description: 'Sweetly scented freesias in soft hues.', price: 36.99, image: 'https://lh3.googleusercontent.com/d/1FlchmH7chNCsQlSRlk-3DU85HGn0X8HM', category: 'Flowers', inStock: true, rating: 4.7 },
    { id: 27, name: 'Amaryllis Red', description: 'Bold red amaryllis for dramatic displays.', price: 55.99, image: 'https://lh3.googleusercontent.com/d/1CyGqnaDgOEcrtc-Nz3E9Wu4zjginendx', category: 'Flowers', inStock: true, rating: 4.8 },
    { id: 28, name: 'Sweet Pea Garden', description: 'Delicate sweet peas with lovely fragrance.', price: 31.99, image: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400', category: 'Flowers', inStock: true, rating: 4.6 },
    { id: 29, name: 'Magnolia Majesty', description: 'Elegant magnolia branches for statement arrangements.', price: 67.99, image: 'https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=400', category: 'Flowers', inStock: true, rating: 4.9 },
    { id: 30, name: 'Jasmine Bliss', description: 'Fragrant jasmine for romantic occasions.', price: 43.99, image: 'https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=400', category: 'Garlands', inStock: true, rating: 4.7 },
    { id: 31, name: 'Gardenia Perfection', description: 'Creamy gardenias with intoxicating scent.', price: 59.99, image: 'https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=400', category: 'Flowers', inStock: true, rating: 4.8 },
    { id: 32, name: 'Zinnia Carnival', description: 'Bright zinnias in rainbow colors.', price: 28.99, image: 'https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=400', category: 'Flowers', inStock: true, rating: 4.5 },
    { id: 33, name: 'Cosmos Cloud', description: 'Airy cosmos flowers in pink and white.', price: 26.99, image: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400', category: 'Garlands', inStock: true, rating: 4.4 },
    { id: 34, name: 'Snapdragon Tower', description: 'Vertical snapdragons adding height to arrangements.', price: 34.99, image: 'https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400', category: 'Flowers', inStock: true, rating: 4.6 },
    { id: 35, name: 'Petunia Paradise', description: 'Cascading petunias in vibrant shades.', price: 23.99, image: 'https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=400', category: 'Flowers', inStock: true, rating: 4.3 },
    { id: 36, name: 'Marigold Gold', description: 'Traditional marigolds in sunny yellow and orange, ideal for garlands.', price: 22.99, image: 'https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=400', category: 'Garlands', inStock: true, rating: 4.4 },
    { id: 37, name: 'Aster Autumn', description: 'Purple asters perfect for fall garlands and arrangements.', price: 29.99, image: 'https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=400', category: 'Garlands', inStock: true, rating: 4.5 },
    { id: 38, name: 'Delphinium Blue', description: 'Tall blue delphiniums for dramatic effect.', price: 46.99, image: 'https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=400', category: 'Flowers', inStock: true, rating: 4.7 },
    { id: 39, name: 'Stock Fragrant', description: 'Sweetly scented stock in pastel shades.', price: 37.99, image: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400', category: 'Flowers', inStock: true, rating: 4.6 },
    { id: 40, name: 'Lisianthus Luxury', description: 'Rose-like lisianthus in soft colors.', price: 51.99, image: 'https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400', category: 'Flowers', inStock: true, rating: 4.8 },
    { id: 41, name: 'Eucalyptus Seeded', description: 'Fresh eucalyptus for greenery arrangements.', price: 19.99, image: 'https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400', category: 'Decoration', inStock: true, rating: 4.5 },
    { id: 42, name: 'Baby Breath Cloud', description: 'Delicate baby breath for filler or solo arrangements.', price: 18.99, image: 'https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=400', category: 'Decoration', inStock: true, rating: 4.4 },
    { id: 43, name: 'Fern Forest', description: 'Lush fern fronds for natural arrangements.', price: 21.99, image: 'https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400', category: 'Decoration', inStock: true, rating: 4.3 },
    { id: 44, name: 'Dusty Miller', description: 'Silver-grey dusty miller for texture.', price: 17.99, image: 'https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=400', category: 'Decoration', inStock: true, rating: 4.2 },
    { id: 45, name: 'Olive Branch', description: 'Mediterranean olive branches for rustic style.', price: 25.99, image: 'https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400', category: 'Decoration', inStock: true, rating: 4.6 },
    { id: 46, name: 'Pink Rose Garden', description: 'Soft pink roses for romantic gestures.', price: 47.99, image: 'https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400', category: 'Flowers', inStock: true, rating: 4.8 },
    { id: 47, name: 'Orange Rose Sunset', description: 'Warm orange roses for vibrant arrangements.', price: 45.99, image: 'https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400', category: 'Flowers', inStock: true, rating: 4.7 },
    { id: 48, name: 'Peach Rose Blush', description: 'Delicate peach roses for elegant occasions.', price: 48.99, image: 'https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400', category: 'Flowers', inStock: true, rating: 4.8 },
    { id: 49, name: 'Coral Rose Joy', description: 'Cheerful coral roses for celebrations.', price: 46.99, image: 'https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400', category: 'Flowers', inStock: true, rating: 4.7 },
    { id: 50, name: 'Lavender Rose Dream', description: 'Unique lavender roses for special moments.', price: 52.99, image: 'https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400', category: 'Flowers', inStock: true, rating: 4.9 },
    { id: 51, name: 'Mini Sunflower Bunch', description: 'Petite sunflowers for compact arrangements.', price: 28.99, image: 'https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=400', category: 'Flowers', inStock: true, rating: 4.5 },
    { id: 52, name: 'Giant Sunflower Single', description: 'Statement single giant sunflower.', price: 15.99, image: 'https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=400', category: 'Flowers', inStock: true, rating: 4.6 },
    { id: 53, name: 'Stargazer Lily', description: 'Fragrant stargazer lilies in pink.', price: 56.99, image: 'https://images.unsplash.com/photo-1606041008023-472dfb5e530f?w=400', category: 'Flowers', inStock: true, rating: 4.8 },
    { id: 54, name: 'Tiger Lily Wild', description: 'Spotted tiger lilies for exotic flair.', price: 49.99, image: 'https://images.unsplash.com/photo-1606041008023-472dfb5e530f?w=400', category: 'Flowers', inStock: true, rating: 4.7 },
    { id: 55, name: 'Asiatic Lily Mix', description: 'Colorful asiatic lilies in mixed hues.', price: 44.99, image: 'https://images.unsplash.com/photo-1606041008023-472dfb5e530f?w=400', category: 'Flowers', inStock: true, rating: 4.6 },
    { id: 56, name: 'Red Tulip Romance', description: 'Classic red tulips for love.', price: 34.99, image: 'https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400', category: 'Flowers', inStock: true, rating: 4.7 },
    { id: 57, name: 'Yellow Tulip Sunshine', description: 'Bright yellow tulips for happiness.', price: 32.99, image: 'https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400', category: 'Flowers', inStock: true, rating: 4.6 },
    { id: 58, name: 'Purple Tulip Royal', description: 'Regal purple tulips for elegance.', price: 35.99, image: 'https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400', category: 'Flowers', inStock: true, rating: 4.7 },
    { id: 59, name: 'White Tulip Pure', description: 'Pure white tulips for simplicity.', price: 33.99, image: 'https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400', category: 'Flowers', inStock: true, rating: 4.6 },
    { id: 60, name: 'Parrot Tulip Fancy', description: 'Frilly parrot tulips in mixed colors.', price: 39.99, image: 'https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400', category: 'Flowers', inStock: true, rating: 4.8 },
    { id: 61, name: 'White Carnation Pure', description: 'Classic white carnations for any occasion.', price: 24.99, image: 'https://images.unsplash.com/photo-1526047932273-341f2a7631f9?w=400', category: 'Flowers', inStock: true, rating: 4.4 },
    { id: 62, name: 'Red Carnation Love', description: 'Deep red carnations expressing love.', price: 26.99, image: 'https://images.unsplash.com/photo-1526047932273-341f2a7631f9?w=400', category: 'Flowers', inStock: true, rating: 4.5 },
    { id: 63, name: 'Pink Carnation Sweet', description: 'Sweet pink carnations for gratitude.', price: 25.99, image: 'https://images.unsplash.com/photo-1526047932273-341f2a7631f9?w=400', category: 'Flowers', inStock: true, rating: 4.4 },
    { id: 64, name: 'White Peony Bride', description: 'Bridal white peonies for weddings.', price: 69.99, image: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400', category: 'Flowers', inStock: true, rating: 4.9 },
    { id: 65, name: 'Blush Peony Romance', description: 'Soft blush peonies for romance.', price: 66.99, image: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400', category: 'Flowers', inStock: true, rating: 4.9 },
    { id: 66, name: 'Coral Peony Joy', description: 'Vibrant coral peonies for celebrations.', price: 67.99, image: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400', category: 'Flowers', inStock: true, rating: 4.8 },
    { id: 67, name: 'White Orchid Zen', description: 'Peaceful white orchids for tranquility.', price: 74.99, image: 'https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=400', category: 'Flowers', inStock: true, rating: 4.8 },
    { id: 68, name: 'Purple Orchid Royal', description: 'Majestic purple orchids for luxury.', price: 82.99, image: 'https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=400', category: 'Flowers', inStock: true, rating: 4.9 },
    { id: 69, name: 'Yellow Orchid Exotic', description: 'Sunny yellow orchids for brightness.', price: 77.99, image: 'https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=400', category: 'Flowers', inStock: true, rating: 4.7 },
    { id: 70, name: 'Mixed Orchid Pot', description: 'Potted orchid mix for lasting beauty.', price: 89.99, image: 'https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=400', category: 'Bouquets', inStock: true, rating: 4.9 },
    { id: 71, name: 'Bird of Paradise', description: 'Striking bird of paradise flowers.', price: 62.99, image: 'https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400', category: 'Flowers', inStock: true, rating: 4.8 },
    { id: 72, name: 'Anthurium Red', description: 'Glossy red anthuriums for modern style.', price: 54.99, image: 'https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400', category: 'Flowers', inStock: true, rating: 4.7 },
    { id: 73, name: 'Heliconia Exotic', description: 'Dramatic heliconia for tropical vibes.', price: 58.99, image: 'https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400', category: 'Flowers', inStock: true, rating: 4.6 },
    { id: 74, name: 'Ginger Flower', description: 'Unique ginger flowers for exotic arrangements.', price: 49.99, image: 'https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400', category: 'Flowers', inStock: true, rating: 4.7 },
    { id: 75, name: 'Plumeria Hawaiian', description: 'Fragrant Hawaiian plumeria flowers.', price: 44.99, image: 'https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400', category: 'Flowers', inStock: true, rating: 4.8 },
    { id: 76, name: 'Birthday Celebration Box', description: 'Festive arrangement for birthdays.', price: 79.99, image: 'https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=400', category: 'Flower Braids', inStock: true, rating: 4.9 },
    { id: 77, name: 'Anniversary Deluxe', description: 'Romantic arrangement for anniversaries.', price: 99.99, image: 'https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=400', category: 'Flower Braids', inStock: true, rating: 5.0 },
    { id: 78, name: 'Get Well Wishes', description: 'Cheerful bouquet for recovery wishes.', price: 54.99, image: 'https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=400', category: 'Bouquets', inStock: true, rating: 4.7 },
    { id: 79, name: 'Sympathy White', description: 'Respectful white arrangement for sympathy.', price: 74.99, image: 'https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=400', category: 'Flower Braids', inStock: true, rating: 4.8 },
    { id: 80, name: 'Congratulations Burst', description: 'Celebratory arrangement for achievements.', price: 64.99, image: 'https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=400', category: 'Bouquets', inStock: true, rating: 4.7 },
    { id: 81, name: 'Thank You Bouquet', description: 'Grateful arrangement to say thanks.', price: 49.99, image: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400', category: 'Bouquets', inStock: true, rating: 4.6 },
    { id: 82, name: 'New Baby Pink', description: 'Soft pink flowers for baby girl.', price: 56.99, image: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400', category: 'Flower Braids', inStock: true, rating: 4.8 },
    { id: 83, name: 'New Baby Blue', description: 'Gentle blue flowers for baby boy.', price: 56.99, image: 'https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=400', category: 'Flower Braids', inStock: true, rating: 4.8 },
    { id: 84, name: 'Mothers Day Special', description: 'Special arrangement for mothers.', price: 69.99, image: 'https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400', category: 'Flower Braids', inStock: true, rating: 4.9 },
    { id: 85, name: 'Valentine Romance', description: 'Romantic red roses for Valentine.', price: 79.99, image: 'https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400', category: 'Flower Braids', inStock: true, rating: 5.0 },
    { id: 86, name: 'Christmas Joy', description: 'Festive holiday arrangement.', price: 72.99, image: 'https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=400', category: 'Flower Braids', inStock: true, rating: 4.8 },
    { id: 87, name: 'Easter Spring', description: 'Fresh spring arrangement for Easter.', price: 54.99, image: 'https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400', category: 'Flower Braids', inStock: true, rating: 4.7 },
    { id: 88, name: 'Thanksgiving Harvest', description: 'Autumn harvest arrangement.', price: 64.99, image: 'https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400', category: 'Flower Braids', inStock: true, rating: 4.7 },
    { id: 89, name: 'Succulent Garden', description: 'Long-lasting succulent arrangement.', price: 42.99, image: 'https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400', category: 'Decoration', inStock: true, rating: 4.6 },
    { id: 90, name: 'Potted Peace Lily', description: 'Air-purifying peace lily plant.', price: 39.99, image: 'https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400', category: 'Decoration', inStock: true, rating: 4.7 },
    { id: 91, name: 'Mini Rose Plant', description: 'Potted miniature rose plant.', price: 34.99, image: 'https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400', category: 'Decoration', inStock: true, rating: 4.5 },
    { id: 92, name: 'Herb Garden Kit', description: 'Fresh herb plants for cooking.', price: 29.99, image: 'https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400', category: 'Decoration', inStock: true, rating: 4.4 },
    { id: 93, name: 'Bonsai Tree', description: 'Artistic bonsai tree for decor.', price: 89.99, image: 'https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400', category: 'Decoration', inStock: true, rating: 4.9 },
    { id: 94, name: 'Wedding Bridal Bouquet', description: 'Elegant bridal bouquet for weddings.', price: 149.99, image: 'https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=400', category: 'Bouquets', inStock: true, rating: 5.0 },
    { id: 95, name: 'Bridesmaid Bouquet', description: 'Coordinating bridesmaid bouquet.', price: 69.99, image: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400', category: 'Bouquets', inStock: true, rating: 4.9 },
    { id: 96, name: 'Boutonniere Classic', description: 'Classic boutonniere for groom.', price: 19.99, image: 'https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400', category: 'Garlands', inStock: true, rating: 4.7 },
    { id: 97, name: 'Corsage Elegant', description: 'Elegant wrist corsage.', price: 29.99, image: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400', category: 'Garlands', inStock: true, rating: 4.8 },
    { id: 98, name: 'Centerpiece Grand', description: 'Grand table centerpiece.', price: 119.99, image: 'https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=400', category: 'Decoration', inStock: true, rating: 4.9 },
    { id: 99, name: 'Flower Crown', description: 'Bohemian flower crown for events.', price: 44.99, image: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400', category: 'Garlands', inStock: true, rating: 4.7 },
    { id: 100, name: 'Dried Flower Bundle', description: 'Long-lasting dried flower arrangement.', price: 38.99, image: 'https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=400', category: 'Decoration', inStock: true, rating: 4.6 }
  ];

  getProducts(): Product[] {
    return this.products;
  }

  getProductById(id: number): Product | undefined {
    return this.products.find(p => p.id === id);
  }

  getProductsByCategory(category: string): Product[] {
    return this.products.filter(p => p.category === category);
  }

  getCategories(): string[] {
    return [...new Set(this.products.map(p => p.category))];
  }

  getFeaturedProducts(): Product[] {
    return this.products.filter(p => p.rating >= 4.8).slice(0, 6);
  }
}
