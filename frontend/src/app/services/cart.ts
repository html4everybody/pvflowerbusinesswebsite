import { Injectable, signal, computed, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Product, CartItem, sellPrice } from '../models/product.model';
import { AuthService } from './auth';
import { ToastService } from './toast';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class CartService {
  private cartItems = signal<CartItem[]>([]);
  cartBounce = signal(false);
  // False until the initial fetch (or a re-fetch after login/logout) has
  // resolved — cartCount() is legitimately 0 while this is still false,
  // which callers that redirect on "cart is empty" must not mistake for
  // an actually-empty cart (checkout.ts used to race this on a fresh page
  // load / refresh and bounce a logged-in user with real items back to
  // /cart before their server cart had even loaded).
  loaded = signal(false);

  items = this.cartItems.asReadonly();

  cartCount = computed(() =>
    this.cartItems().reduce((total, item) => total + item.quantity, 0)
  );

  cartTotal = computed(() =>
    this.cartItems().reduce((total, item) => total + (sellPrice(item.product) * item.quantity), 0)
  );

  constructor(
    private authService: AuthService,
    private http: HttpClient,
    private toastService: ToastService
  ) {
    // A separate direct fetchCart() call used to sit here alongside this
    // effect (which already runs once on creation, then again on auth
    // change) — both independently read the guest cart from localStorage
    // before either's HTTP response landed, so a logged-in user's guest
    // cart items could get merged into their server cart twice.
    effect(() => {
      this.authService.user(); // track signal
      this.cartItems.set([]);
      this.loaded.set(false);
      this.fetchCart();
    });
  }

  private fetchCart(): void {
    const user = this.authService.user();
    if (user) {
      const token = this.authService.getToken();
      const guestItems = this.loadFromLocalStorage();
      this.http.get<CartItem[]>(`${environment.apiUrl}/api/cart?user_id=${user.id}&token=${encodeURIComponent(token)}`).subscribe({
        next: (dbItems) => {
          this.cartItems.set(dbItems);
          // Merge guest cart into user's DB cart on login
          if (guestItems.length > 0) {
            localStorage.removeItem('viva_cart_guest');
            for (const gItem of guestItems) {
              const existing = dbItems.find(i => i.product.id === gItem.product.id);
              const newQty = existing ? existing.quantity + gItem.quantity : gItem.quantity;
              this.http.post(`${environment.apiUrl}/api/cart/item`, {
                user_id: user.id,
                product_id: gItem.product.id,
                quantity: newQty,
                token
              }).subscribe();
              this.cartItems.update(current => {
                const ex = current.find(i => i.product.id === gItem.product.id);
                if (ex) {
                  return current.map(i => i.product.id === gItem.product.id ? { ...i, quantity: newQty } : i);
                }
                return [...current, gItem];
              });
            }
          }
          this.loaded.set(true);
        },
        error: () => { this.cartItems.set([]); this.loaded.set(true); }
      });
    } else {
      // Guest: load cart from localStorage (synchronous — already "loaded")
      this.cartItems.set(this.loadFromLocalStorage());
      this.loaded.set(true);
    }
  }

  // ── Guest localStorage helpers ──────────────────────────────────────────────

  private loadFromLocalStorage(): CartItem[] {
    try {
      const stored = localStorage.getItem('viva_cart_guest');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  private saveToLocalStorage(): void {
    localStorage.setItem('viva_cart_guest', JSON.stringify(this.cartItems()));
  }

  // ── Cart mutations ──────────────────────────────────────────────────────────

  addToCart(product: Product, quantity: number = 1): boolean {
    // Merchant accounts are sellers, not buyers — they can browse but not shop.
    if (this.authService.isMerchant()) {
      this.toastService.show('Merchant accounts are for selling, not shopping', 'error');
      return false;
    }
    const currentItems = this.cartItems();
    const existing = currentItems.find(item => item.product.id === product.id);
    const newQuantity = existing ? existing.quantity + quantity : quantity;

    if (existing) {
      this.cartItems.set(
        currentItems.map(item =>
          item.product.id === product.id ? { ...item, quantity: newQuantity } : item
        )
      );
    } else {
      this.cartItems.set([...currentItems, { product, quantity }]);
    }

    this.persist(product.id, newQuantity);
    this.triggerBounce();
    return true;
  }

  private triggerBounce(): void {
    this.cartBounce.set(true);
    setTimeout(() => this.cartBounce.set(false), 600);
  }

  removeFromCart(productId: string): void {
    this.cartItems.set(this.cartItems().filter(item => item.product.id !== productId));

    const user = this.authService.user();
    if (user) {
      const token = this.authService.getToken();
      this.http.delete(`${environment.apiUrl}/api/cart/item/${productId}?user_id=${user.id}&token=${encodeURIComponent(token)}`).subscribe({
        error: () => this.toastService.show('Could not update your cart — please refresh and try again.', 'error'),
      });
    } else {
      this.saveToLocalStorage();
    }
  }

  updateQuantity(productId: string, quantity: number): void {
    if (quantity <= 0) {
      this.removeFromCart(productId);
      return;
    }
    this.cartItems.set(
      this.cartItems().map(item =>
        item.product.id === productId ? { ...item, quantity } : item
      )
    );
    this.persist(productId, quantity);
  }

  clearCart(): void {
    this.cartItems.set([]);

    const user = this.authService.user();
    if (user) {
      const token = this.authService.getToken();
      this.http.delete(`${environment.apiUrl}/api/cart/clear?user_id=${user.id}&token=${encodeURIComponent(token)}`).subscribe({
        error: () => this.toastService.show('Could not clear your cart — please refresh and try again.', 'error'),
      });
    } else {
      this.saveToLocalStorage();
    }
  }

  getCartItems(): CartItem[] {
    return this.cartItems();
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private persist(productId: string, quantity: number): void {
    const user = this.authService.user();
    if (user) {
      // Optimistic — the UI already reflects the new quantity. On failure
      // this used to leave local state silently diverged from the server
      // with no notice at all; a toast at least tells the customer their
      // change might not have actually saved.
      this.http.post(`${environment.apiUrl}/api/cart/item`, {
        user_id: user.id,
        product_id: productId,
        quantity,
        token: this.authService.getToken(),
      }).subscribe({
        error: () => this.toastService.show('Could not update your cart — please refresh and try again.', 'error'),
      });
    } else {
      this.saveToLocalStorage();
    }
  }
}
