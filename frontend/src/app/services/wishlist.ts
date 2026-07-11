import { Injectable, signal, computed, effect } from '@angular/core';
import { Product } from '../models/product.model';
import { AuthService } from './auth';

const KEY = 'viva_wishlist';

@Injectable({ providedIn: 'root' })
export class WishlistService {
  private _ids = signal<number[]>([]);
  readonly count = computed(() => this._ids().length);

  constructor(private authService: AuthService) {
    // Load wishlist from localStorage for both guests and logged-in users.
    // Saved items persist across sessions and seamlessly carry over on login.
    effect(() => {
      this.authService.user(); // track signal so wishlist reacts to auth changes
      this._ids.set(this.load());
    });
  }

  has(id: number): boolean { return this._ids().includes(id); }

  toggle(product: Product): boolean {
    this._ids.update(ids =>
      ids.includes(product.id) ? ids.filter(i => i !== product.id) : [...ids, product.id]
    );
    this.save();
    return true;
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
