import { Injectable, signal, computed, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Product, CartItem, sellPrice } from '../models/product.model';
import { AuthService } from './auth';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class CartService {
  private cartItems = signal<CartItem[]>([]);
  cartBounce = signal(false);

  items = this.cartItems.asReadonly();

  cartCount = computed(() =>
    this.cartItems().reduce((total, item) => total + item.quantity, 0)
  );

  cartTotal = computed(() =>
    this.cartItems().reduce((total, item) => total + (sellPrice(item.product) * item.quantity), 0)
  );

  constructor(
    private authService: AuthService,
    private http: HttpClient
  ) {
    // Load cart on startup
    this.fetchCart();

    // Reload cart whenever auth state changes (login / logout)
    effect(() => {
      this.authService.user(); // track signal
      this.cartItems.set([]);
      this.fetchCart();
    });
  }

  private fetchCart(): void {
    const user = this.authService.user();
    if (user) {
      const guestItems = this.loadFromLocalStorage();
      this.http.get<CartItem[]>(`${environment.apiUrl}/api/cart?user_id=${user.id}`).subscribe({
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
                quantity: newQty
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
        },
        error: () => this.cartItems.set([])
      });
    } else {
      // Guest: load cart from localStorage
      this.cartItems.set(this.loadFromLocalStorage());
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

  removeFromCart(productId: number): void {
    this.cartItems.set(this.cartItems().filter(item => item.product.id !== productId));

    const user = this.authService.user();
    if (user) {
      this.http.delete(`${environment.apiUrl}/api/cart/item/${productId}?user_id=${user.id}`).subscribe();
    } else {
      this.saveToLocalStorage();
    }
  }

  updateQuantity(productId: number, quantity: number): void {
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
      this.http.delete(`${environment.apiUrl}/api/cart/clear?user_id=${user.id}`).subscribe();
    } else {
      this.saveToLocalStorage();
    }
  }

  getCartItems(): CartItem[] {
    return this.cartItems();
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private persist(productId: number, quantity: number): void {
    const user = this.authService.user();
    if (user) {
      this.http.post(`${environment.apiUrl}/api/cart/item`, {
        user_id: user.id,
        product_id: productId,
        quantity
      }).subscribe();
    } else {
      this.saveToLocalStorage();
    }
  }
}
