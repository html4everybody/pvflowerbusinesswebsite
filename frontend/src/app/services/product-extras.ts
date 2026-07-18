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

  getFrequentlyBoughtTogether(product: Product): Product[] {
    const all = this.productService.getProducts();
    const sameList = all.filter(p => p.category === product.category && p.id !== product.id);
    const compCategory = this.compMap[product.category] ?? 'Bouquets';
    const compList = all.filter(p => p.category === compCategory);

    const n = parseInt(product.id.split('-')[1] || '0', 10);
    const result: Product[] = [];
    if (sameList.length > 0) result.push(sameList[(n * 3) % sameList.length]);
    if (compList.length > 0) result.push(compList[(n * 7) % compList.length]);
    return result;
  }
}
