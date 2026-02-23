import { Injectable, signal, computed } from '@angular/core';
import { Product, CartItem } from '../models/product.model';

@Injectable({
  providedIn: 'root'
})
export class CartService {
  private cartItems = signal<CartItem[]>([]);

  items = this.cartItems.asReadonly();

  cartCount = computed(() =>
    this.cartItems().reduce((total, item) => total + item.quantity, 0)
  );

  cartTotal = computed(() =>
    this.cartItems().reduce((total, item) => total + (item.product.price * item.quantity), 0)
  );

  addToCart(product: Product, quantity: number = 1): void {
    const currentItems = this.cartItems();
    const existingItem = currentItems.find(item => item.product.id === product.id);

    if (existingItem) {
      this.cartItems.set(
        currentItems.map(item =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        )
      );
    } else {
      this.cartItems.set([...currentItems, { product, quantity }]);
    }
  }

  removeFromCart(productId: number): void {
    this.cartItems.set(
      this.cartItems().filter(item => item.product.id !== productId)
    );
  }

  updateQuantity(productId: number, quantity: number): void {
    if (quantity <= 0) {
      this.removeFromCart(productId);
      return;
    }

    this.cartItems.set(
      this.cartItems().map(item =>
        item.product.id === productId
          ? { ...item, quantity }
          : item
      )
    );
  }

  clearCart(): void {
    this.cartItems.set([]);
  }

  getCartItems(): CartItem[] {
    return this.cartItems();
  }
}