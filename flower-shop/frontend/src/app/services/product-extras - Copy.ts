import { Injectable } from '@angular/core';
import { Product } from '../models/product.model';
import { ProductService } from './product';

export interface CareTip {
  icon: string;
  title: string;
  detail: string;
}

export interface Review {
  id: number;
  author: string;
  avatar: string;
  rating: number;
  date: string;
  text: string;
  photos?: string[];
  verified: boolean;
}

@Injectable({ providedIn: 'root' })
export class ProductExtrasService {

  constructor(private productService: ProductService) {}

  private galleryMap: Record<string, string[]> = {
    'Garlands': [
      'https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=600&q=80',
      'https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=600&q=80',
      'https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=600&q=80',
    ],
    'Flowers': [
      'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=600&q=80',
      'https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=600&q=80',
      'https://images.unsplash.com/photo-1526047932273-341f2a7631f9?w=600&q=80',
    ],
    'Bouquets': [
      'https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=600&q=80',
      'https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=600&q=80',
      'https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=600&q=80',
    ],
    'Flower Braids': [
      'https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=600&q=80',
      'https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=600&q=80',
      'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=600&q=80',
    ],
    'Decoration': [
      'https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=600&q=80',
      'https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=600&q=80',
      'https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=600&q=80',
    ],
  };

  private careTipsMap: Record<string, CareTip[]> = {
    'Garlands': [
      { icon: '💧', title: 'Daily Misting', detail: 'Lightly mist the garland twice daily to keep petals hydrated and fresh.' },
      { icon: '🌫️', title: 'Maintain Humidity', detail: 'Store in a humid environment or near a water source to prevent drying out.' },
      { icon: '🌤️', title: 'Avoid Direct Sun', detail: 'Keep in indirect light or cool shade — direct sun accelerates wilting.' },
      { icon: '✂️', title: 'Remove Wilted Blooms', detail: 'Trim faded flowers promptly to preserve the freshness of remaining blooms.' },
      { icon: '🌿', title: 'Flower Food Soak', detail: 'Soak the base in a flower food solution for 30 min before displaying.' },
    ],
    'Flowers': [
      { icon: '✂️', title: 'Diagonal Stem Cut', detail: 'Cut stems at a 45° angle to maximise the surface area for water absorption.' },
      { icon: '💧', title: 'Use Cold Water', detail: 'Fill the vase with cold, clean water. Avoid warm water which speeds decay.' },
      { icon: '🍎', title: 'Away from Fruit', detail: 'Keep away from fruit bowls — ethylene gas released by fruits wilts flowers faster.' },
      { icon: '🔆', title: 'Indirect Light', detail: 'Place in bright, indirect light. Avoid heat sources and direct afternoon sun.' },
      { icon: '🔄', title: 'Change Water Every 2 Days', detail: 'Refresh vase water every 2 days and recut stems to extend vase life.' },
    ],
    'Bouquets': [
      { icon: '✂️', title: 'Recut on Arrival', detail: 'Recut stems at a 45° angle as soon as the bouquet arrives to open up hydration.' },
      { icon: '🍃', title: 'Remove Submerged Leaves', detail: 'Strip any leaves below the waterline to prevent bacterial build-up.' },
      { icon: '🌿', title: 'Add Flower Food', detail: 'Use the provided flower food packet — it balances pH and feeds the flowers.' },
      { icon: '💨', title: 'Avoid Drafts', detail: 'Keep away from AC vents, open windows, and cold drafts to prevent early wilting.' },
      { icon: '🌡️', title: 'Ideal Temperature', detail: 'Maintain room temperature between 18–22°C for the longest vase life.' },
    ],
    'Flower Braids': [
      { icon: '💧', title: 'Light Misting', detail: 'Mist lightly with clean water twice a day to keep the braid looking fresh.' },
      { icon: '❄️', title: 'Keep Cool', detail: 'Store in the coolest room available — heat is the number-one enemy of braids.' },
      { icon: '🚫', title: 'No Direct Heat', detail: 'Avoid placing near radiators, sunlit windows, or any heat-emitting appliances.' },
      { icon: '🌑', title: 'Dry Naturally', detail: 'If drying, hang away from direct sunlight to preserve colour and shape.' },
      { icon: '⏰', title: 'Display Quickly', detail: 'For best appearance, display within 24 hours of delivery.' },
    ],
    'Decoration': [
      { icon: '💧', title: 'Keep Hydrated', detail: 'If the arrangement contains fresh blooms, top up water daily.' },
      { icon: '🔆', title: 'No Direct Sunlight', detail: 'Direct sun fades colours — position in well-lit spots away from windows.' },
      { icon: '🪨', title: 'Stable Surface', detail: 'Place on a flat, stable surface to avoid tipping and stem damage.' },
      { icon: '❄️', title: 'Refrigerate Overnight', detail: 'Extend freshness by refrigerating the arrangement overnight when possible.' },
      { icon: '🌬️', title: 'Mist the Petals', detail: 'A light mist on petals each morning keeps them vibrant and prevents browning.' },
    ],
  };

  private reviewPool: Review[] = [
    { id: 1, author: 'Priya S.', avatar: 'https://i.pravatar.cc/60?img=1', rating: 5, date: 'Feb 12, 2026', text: 'Absolutely stunning! The flowers arrived fresh and beautifully arranged. My mom was in tears of joy.', verified: true },
    { id: 2, author: 'Arjun M.', avatar: 'https://i.pravatar.cc/60?img=2', rating: 4, date: 'Jan 28, 2026', text: 'Great quality flowers. Delivery was on time and packaging was excellent. Will definitely order again!', verified: true },
    { id: 3, author: 'Meera R.', avatar: 'https://i.pravatar.cc/60?img=3', rating: 5, date: 'Feb 5, 2026', text: 'The most gorgeous arrangement I have ever received. Every single bloom was perfect.', photos: ['https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=200&q=80'], verified: true },
    { id: 4, author: 'Kavya T.', avatar: 'https://i.pravatar.cc/60?img=4', rating: 3, date: 'Jan 15, 2026', text: 'Decent flowers but a couple were slightly wilted on arrival. Customer service was helpful though.', verified: false },
    { id: 5, author: 'Rajan K.', avatar: 'https://i.pravatar.cc/60?img=5', rating: 5, date: 'Feb 18, 2026', text: 'Ordered for our anniversary and FloranFlowers exceeded every expectation. Truly top class!', photos: ['https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=200&q=80', 'https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=200&q=80'], verified: true },
    { id: 6, author: 'Anjali P.', avatar: 'https://i.pravatar.cc/60?img=6', rating: 4, date: 'Jan 22, 2026', text: 'Beautiful flowers with a great fragrance. They lasted over a week with proper care.', verified: true },
    { id: 7, author: 'Vikram N.', avatar: 'https://i.pravatar.cc/60?img=7', rating: 5, date: 'Feb 8, 2026', text: 'Ordered same-day delivery and was shocked at how fresh they were on arrival. Highly recommend!', verified: false },
    { id: 8, author: 'Deepa L.', avatar: 'https://i.pravatar.cc/60?img=8', rating: 4, date: 'Jan 30, 2026', text: 'Lovely arrangement. The colors matched the website photos perfectly — no surprises!', photos: ['https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=200&q=80'], verified: true },
    { id: 9, author: 'Suresh B.', avatar: 'https://i.pravatar.cc/60?img=9', rating: 5, date: 'Feb 14, 2026', text: "Gifted this to my wife on Valentine's Day. She absolutely loved it. Worth every rupee!", verified: true },
    { id: 10, author: 'Kiran A.', avatar: 'https://i.pravatar.cc/60?img=10', rating: 4, date: 'Jan 19, 2026', text: 'Good quality and reasonable price. The protective packaging kept every flower safe.', verified: true },
    { id: 11, author: 'Nisha J.', avatar: 'https://i.pravatar.cc/60?img=11', rating: 5, date: 'Feb 2, 2026', text: 'I order from FloranFlowers for every special occasion — never once disappointed!', photos: ['https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=200&q=80'], verified: true },
    { id: 12, author: 'Rahul C.', avatar: 'https://i.pravatar.cc/60?img=12', rating: 3, date: 'Jan 10, 2026', text: 'Flowers were nice but delivery took longer than expected. Would be 5 stars with faster shipping.', verified: false },
    { id: 13, author: 'Pooja D.', avatar: 'https://i.pravatar.cc/60?img=13', rating: 5, date: 'Feb 20, 2026', text: 'The garland was so fresh and fragrant. Absolutely perfect for our puja ceremony!', verified: true },
    { id: 14, author: 'Arun S.', avatar: 'https://i.pravatar.cc/60?img=14', rating: 4, date: 'Jan 25, 2026', text: 'Very happy with the quality. The blooms stayed vibrant for nearly 10 days.', photos: ['https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=200&q=80', 'https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=200&q=80'], verified: true },
    { id: 15, author: 'Sneha V.', avatar: 'https://i.pravatar.cc/60?img=15', rating: 5, date: 'Feb 25, 2026', text: 'Absolutely beautiful! The arrangement was exactly as shown. Perfect gift for my sister.', verified: true },
  ];

  private compMap: Record<string, string> = {
    'Garlands': 'Decoration',
    'Flowers': 'Bouquets',
    'Bouquets': 'Flower Braids',
    'Flower Braids': 'Flowers',
    'Decoration': 'Garlands',
  };

  getGalleryImages(product: Product): string[] {
    const extras = this.galleryMap[product.category] ?? this.galleryMap['Flowers'];
    return [product.image, ...extras];
  }

  getCareTips(category: string): CareTip[] {
    return this.careTipsMap[category] ?? this.careTipsMap['Flowers'];
  }

  getReviews(productId: number): Review[] {
    const pool = this.reviewPool;
    const startIdx = productId % pool.length;
    const result: Review[] = [];
    for (let i = 0; i < 5; i++) {
      result.push(pool[(startIdx + i) % pool.length]);
    }
    return result;
  }

  getFrequentlyBoughtTogether(product: Product): Product[] {
    const all = this.productService.getProducts();
    const sameList = all.filter(p => p.category === product.category && p.id !== product.id);
    const compCategory = this.compMap[product.category] ?? 'Bouquets';
    const compList = all.filter(p => p.category === compCategory);

    const result: Product[] = [];
    if (sameList.length > 0) result.push(sameList[(product.id * 3) % sameList.length]);
    if (compList.length > 0) result.push(compList[(product.id * 7) % compList.length]);
    return result;
  }
}
