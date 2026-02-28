import { Component, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { CartService } from '../../services/cart';
import { AuthService } from '../../services/auth';
import { ConfettiService } from '../../services/confetti';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-checkout',
  imports: [RouterLink, FormsModule],
  templateUrl: './checkout.html',
  styleUrl: './checkout.scss'
})
export class Checkout {
  orderPlaced = signal(false);
  orderNumber = signal('');
  loading = signal(false);
  errorMessage = signal('');
  deliveryType = signal<'immediate' | 'scheduled'>('immediate');

  minDate = new Date().toISOString().split('T')[0];

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
    giftMessage: '',
    deliveryDate: '',
    deliveryTime: ''
  };

  constructor(
    public cartService: CartService,
    public authService: AuthService,
    private http: HttpClient,
    private router: Router,
    private confetti: ConfettiService
  ) {
    if (this.cartService.cartCount() === 0) {
      this.router.navigate(['/cart']);
    }

    // Pre-fill name and email from logged-in user
    const user = this.authService.user();
    if (user) {
      this.formData.firstName = user.firstName;
      this.formData.lastName = user.lastName;
      this.formData.email = user.email;
    }
  }

  getShipping(): number {
    return this.cartService.cartTotal() >= 50 ? 0 : 9.99;
  }

  getTotal(): number {
    return this.cartService.cartTotal() + this.getShipping();
  }

  placeOrder(): void {
    this.loading.set(true);
    this.errorMessage.set('');

    // Always use logged-in user's email if available
    const user = this.authService.user();
    const customerEmail = user ? user.email : this.formData.email;

    const deliveryDatetime = this.deliveryType() === 'scheduled' && this.formData.deliveryDate && this.formData.deliveryTime
      ? `${this.formData.deliveryDate}T${this.formData.deliveryTime}`
      : null;

    const payload = {
      items: this.cartService.getCartItems().map(item => ({
        productId: item.product.id,
        name: item.product.name,
        price: item.product.price,
        quantity: item.quantity
      })),
      total: this.getTotal(),
      customer: {
        name: `${this.formData.firstName} ${this.formData.lastName}`.trim(),
        email: customerEmail,
        phone: this.formData.phone,
        address: this.formData.address,
        city: this.formData.city,
        state: this.formData.state,
        zip: this.formData.zip
      },
      delivery_type: this.deliveryType(),
      delivery_datetime: deliveryDatetime
    };

    this.http.post<{ orderId: string; status: string }>(`${environment.apiUrl}/api/orders`, payload).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.orderNumber.set(res.orderId);
        this.orderPlaced.set(true);
        this.cartService.clearCart();
        setTimeout(() => this.confetti.burst(), 300);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set('Something went wrong. Please try again.');
      }
    });
  }
}
