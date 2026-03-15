import { Injectable, signal, computed } from '@angular/core';
import { Product } from '../models/product.model';

const KEY = 'floran_wishlist';

@Injectable({ providedIn: 'root' })
export class WishlistService {
  private _ids = signal<number[]>(this.load());
  readonly count = computed(() => this._ids().length);

  has(id: number): boolean { return this._ids().includes(id); }

  toggle(product: Product): void {
    this._ids.update(ids =>
      ids.includes(product.id) ? ids.filter(i => i !== product.id) : [...ids, product.id]
    );
    this.save();
  }

  remove(id: number): void {
    this._ids.update(ids => ids.filter(i => i !== id));
    this.save();
  }

  getIds(): number[] { return this._ids(); }

  clear(): void { this._ids.set([]); this.save(); }

  getShareUrl(): string {
    return `${window.location.origin}/wishlist?ids=${this._ids().join(',')}`;
  }

  private load(): number[] {
    try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
  }

  private save(): void {
    localStorage.setItem(KEY, JSON.stringify(this._ids()));
  }
}
