import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CartService } from '../../services/cart';

@Component({
  selector: 'app-cart',
  imports: [RouterLink],
  templateUrl: './cart.html',
  styleUrl: './cart.scss'
})
export class Cart {
  constructor(public cartService: CartService) {}

  updateQuantity(productId: number, change: number): void {
    const item = this.cartService.getCartItems().find(i => i.product.id === productId);
    if (item) {
      this.cartService.updateQuantity(productId, item.quantity + change);
    }
  }

  removeItem(productId: number): void {
    this.cartService.removeFromCart(productId);
  }
}
