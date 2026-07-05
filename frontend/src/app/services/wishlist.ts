import { Injectable, signal, computed, effect } from '@angular/core';
import { Router } from '@angular/router';
import { Product } from '../models/product.model';
import { AuthService } from './auth';
import { ToastService } from './toast';

const KEY = 'viva_wishlist';

@Injectable({ providedIn: 'root' })
export class WishlistService {
  private _ids = signal<number[]>([]);
  readonly count = computed(() => this._ids().length);

  constructor(private router: Router, private authService: AuthService, private toastService: ToastService) {
    // Wishlist is per-user — show saved items only when signed in; empty for guests.
    effect(() => {
      this._ids.set(this.authService.user() ? this.load() : []);
    });
  }

  has(id: number): boolean { return this._ids().includes(id); }

  toggle(product: Product): boolean {
    // Wishlist is per-user — require login before saving.
    if (!this.authService.isLoggedIn()) {
      this.toastService.show('Please sign in to save to your wishlist', 'error');
      this.router.navigate(['/signin'], { queryParams: { returnUrl: this.router.url } });
      return false;
    }
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
