import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Product } from '../models/product.model';
import { AuthService } from './auth';
import { ToastService } from './toast';

// Previously one global key for every user — on a shared browser, logging
// in as a second user immediately showed (and, on any change, overwrote)
// the first user's wishlist.
const LEGACY_KEY = 'viva_wishlist';

@Injectable({ providedIn: 'root' })
export class WishlistService {
  private _ids = signal<string[]>([]);
  readonly count = computed(() => this._ids().length);
  private router = inject(Router);
  private toast = inject(ToastService);

  constructor(private authService: AuthService) {
    // Only load wishlist for logged-in users; clear for guests.
    effect(() => {
      if (this.authService.user()) {
        this._ids.set(this.load());
      } else {
        this._ids.set([]);
      }
    });
  }

  has(id: string): boolean { return this._ids().includes(id); }

  toggle(product: Product): boolean {
    if (!this.authService.user()) {
      this.toast.show('Please sign in to save items to your wishlist.', 'error');
      setTimeout(() => this.router.navigate(['/signin']), 150);
      return false;
    }
    this._ids.update(ids =>
      ids.includes(product.id) ? ids.filter(i => i !== product.id) : [...ids, product.id]
    );
    this.save();
    return true;
  }

  remove(id: string): void {
    this._ids.update(ids => ids.filter(i => i !== id));
    this.save();
  }

  getIds(): string[] { return this._ids(); }

  clear(): void { this._ids.set([]); this.save(); }

  getShareUrl(): string {
    return `${window.location.origin}/wishlist?ids=${this._ids().join(',')}`;
  }

  private key(): string {
    const email = this.authService.user()?.email;
    return email ? `viva_wishlist_${email}` : LEGACY_KEY;
  }

  private load(): string[] {
    const key = this.key();
    try {
      const own = localStorage.getItem(key);
      if (own !== null) return JSON.parse(own);
      // One-time migration: a wishlist saved under the old shared key
      // (before namespacing) belongs to whoever's logged in right now —
      // move it to their own key and retire the shared one so it can't
      // also leak into the next different user who logs in.
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy !== null) {
        localStorage.setItem(key, legacy);
        localStorage.removeItem(LEGACY_KEY);
        return JSON.parse(legacy);
      }
      return [];
    } catch { return []; }
  }

  private save(): void {
    localStorage.setItem(this.key(), JSON.stringify(this._ids()));
  }
}
