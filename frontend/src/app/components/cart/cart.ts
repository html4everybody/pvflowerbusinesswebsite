import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CartService } from '../../services/cart';
import { FeedbackService } from '../../services/feedback';
import { CartItem, formatQty, unitPriceLabel } from '../../models/product.model';

@Component({
  selector: 'app-cart',
  imports: [RouterLink],
  templateUrl: './cart.html',
  styleUrl: './cart.scss'
})
export class Cart {
  constructor(public cartService: CartService, private feedbackService: FeedbackService) {}

  minQty(item: CartItem): number {
    const type = item.product.unit_type || 'stem';
    if (type === 'weight') return 1;
    return item.product.min_quantity || 1;
  }

  itemQtyLabel(item: CartItem): string {
    return formatQty(item.quantity, item.product);
  }

  itemPriceLabel(item: CartItem): string {
    return unitPriceLabel(item.product);
  }

  updateQuantity(productId: string, change: number): void {
    const item = this.cartService.getCartItems().find(i => i.product.id === productId);
    if (item) {
      const newQty = item.quantity + change;
      if (newQty >= this.minQty(item)) {
        this.cartService.updateQuantity(productId, newQty);
      }
    }
  }

  removeItem(productId: string): void {
    this.cartService.removeFromCart(productId);
    this.feedbackService.removeFromCartFeedback();
  }
}
