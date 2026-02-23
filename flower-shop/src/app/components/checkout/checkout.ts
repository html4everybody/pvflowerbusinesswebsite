import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CartService } from '../../services/cart';

@Component({
  selector: 'app-checkout',
  imports: [RouterLink, FormsModule],
  templateUrl: './checkout.html',
  styleUrl: './checkout.scss'
})
export class Checkout {
  orderPlaced = false;
  orderNumber = '';

  formData = {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    cardName: '',
    cardNumber: '',
    expiry: '',
    cvv: '',
    giftMessage: ''
  };

  constructor(
    public cartService: CartService,
    private router: Router
  ) {
    if (this.cartService.cartCount() === 0) {
      this.router.navigate(['/cart']);
    }
  }

  getShipping(): number {
    return this.cartService.cartTotal() >= 50 ? 0 : 9.99;
  }

  getTotal(): number {
    return this.cartService.cartTotal() + this.getShipping();
  }

  placeOrder(): void {
    this.orderNumber = 'BLM' + Math.random().toString(36).substr(2, 9).toUpperCase();
    this.orderPlaced = true;
    this.cartService.clearCart();
  }
}
