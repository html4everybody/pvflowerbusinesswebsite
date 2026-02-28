import { Injectable, signal, computed } from '@angular/core';
import { BouquetDesign, BouquetFlower, ArrangementStyle, BouquetSize } from '../models/bouquet.model';
import { Product } from '../models/product.model';

const DEFAULT: BouquetDesign = {
  flowers: [],
  style: 'round',
  wrappingColor: '#f8bbd0',
  wrappingName: 'Blush Pink',
  size: 'medium',
};

@Injectable({ providedIn: 'root' })
export class BouquetService {
  readonly design = signal<BouquetDesign>({ ...DEFAULT });

  readonly styles = [
    { id: 'round'     as ArrangementStyle, label: 'Round',     icon: '⭕', desc: 'Classic circular shape' },
    { id: 'cascading' as ArrangementStyle, label: 'Cascade',   icon: '🌊', desc: 'Flowing waterfall style' },
    { id: 'posy'      as ArrangementStyle, label: 'Posy',      icon: '💐', desc: 'Small compact bunch' },
    { id: 'hand-tied' as ArrangementStyle, label: 'Hand Tied', icon: '🎀', desc: 'Natural rustic look' },
  ];

  readonly wrappings = [
    { name: 'Blush Pink',  color: '#f8bbd0' },
    { name: 'Ivory',       color: '#f5f0e8' },
    { name: 'Sage Green',  color: '#c8e6c9' },
    { name: 'Sky Blue',    color: '#bbdefb' },
    { name: 'Lilac',       color: '#e1bee7' },
    { name: 'Kraft Brown', color: '#d7c5a0' },
    { name: 'Crimson',     color: '#b71c1c' },
    { name: 'Charcoal',    color: '#424242' },
  ];

  readonly sizes = [
    { id: 'small'  as BouquetSize, label: 'Petite',  flowers: '3–5',   basePrice: 9.99  },
    { id: 'medium' as BouquetSize, label: 'Classic', flowers: '6–10',  basePrice: 14.99 },
    { id: 'large'  as BouquetSize, label: 'Grand',   flowers: '11–20', basePrice: 24.99 },
  ];

  readonly totalPrice = computed(() => {
    const d = this.design();
    const flowerTotal = d.flowers.reduce((sum, f) => sum + f.price * f.count, 0);
    const sizeBase = this.sizes.find(s => s.id === d.size)!.basePrice;
    return +(flowerTotal + sizeBase).toFixed(2);
  });

  readonly flowerCount = computed(() =>
    this.design().flowers.reduce((sum, f) => sum + f.count, 0)
  );

  getSizeBasePrice(size: BouquetSize): number {
    return this.sizes.find(s => s.id === size)!.basePrice;
  }

  addFlower(product: Product): void {
    this.design.update(d => {
      const existing = d.flowers.find(f => f.productId === product.id);
      if (existing) {
        return { ...d, flowers: d.flowers.map(f =>
          f.productId === product.id ? { ...f, count: f.count + 1 } : f
        )};
      }
      const newFlower: BouquetFlower = {
        productId: product.id,
        name: product.name,
        image: product.image,
        price: product.price,
        count: 1,
      };
      return { ...d, flowers: [...d.flowers, newFlower] };
    });
  }

  removeFlower(productId: number): void {
    this.design.update(d => ({
      ...d,
      flowers: d.flowers.filter(f => f.productId !== productId)
    }));
  }

  updateCount(productId: number, delta: number): void {
    this.design.update(d => ({
      ...d,
      flowers: d.flowers
        .map(f => f.productId === productId ? { ...f, count: f.count + delta } : f)
        .filter(f => f.count > 0)
    }));
  }

  setStyle(style: ArrangementStyle): void {
    this.design.update(d => ({ ...d, style }));
  }

  setWrapping(color: string, name: string): void {
    this.design.update(d => ({ ...d, wrappingColor: color, wrappingName: name }));
  }

  setSize(size: BouquetSize): void {
    this.design.update(d => ({ ...d, size }));
  }

  clearDesign(): void {
    this.design.set({ ...DEFAULT });
  }

  getShareUrl(): string {
    try {
      const encoded = btoa(encodeURIComponent(JSON.stringify(this.design())));
      return `${window.location.origin}/builder?d=${encoded}`;
    } catch {
      return window.location.href;
    }
  }

  loadFromEncoded(encoded: string): void {
    try {
      const design = JSON.parse(decodeURIComponent(atob(encoded)));
      this.design.set(design);
    } catch {}
  }

  getCartProduct(): Product {
    const d = this.design();
    const flowerSummary = d.flowers.map(f => `${f.count}x ${f.name}`).join(', ');
    return {
      id: Date.now(),
      name: `Custom ${d.style.charAt(0).toUpperCase() + d.style.slice(1)} Bouquet`,
      description: `${d.size.charAt(0).toUpperCase() + d.size.slice(1)} bouquet: ${flowerSummary}. Wrapped in ${d.wrappingName}.`,
      price: this.totalPrice(),
      image: d.flowers[0]?.image || 'https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=400',
      category: 'Bouquets',
      inStock: true,
      rating: 5.0,
    };
  }
}
