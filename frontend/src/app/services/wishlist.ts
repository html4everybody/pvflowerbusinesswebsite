import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Product } from '../models/product.model';
import { AuthService } from './auth';
import { ToastService } from './toast';

const KEY = 'viva_wishlist';

@Injectable({ providedIn: 'root' })
export class WishlistService {
  private _ids = signal<number[]>([]);
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

  has(id: number): boolean { return this._ids().includes(id); }

  toggle(product: Product): boolean {
    if (!this.authService.user()) {
      this.toast.show('Please sign in to save items to your wishlist.', 'error');
      this.router.navigate(['/signin']);
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
