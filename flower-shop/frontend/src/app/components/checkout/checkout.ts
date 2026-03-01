import { Component, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { CartService } from '../../services/cart';
import { AuthService } from '../../services/auth';
import { ConfettiService } from '../../services/confetti';
import { LoyaltyService } from '../../services/loyalty';
import { PromoService, PromoResult } from '../../services/promo';
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
  isRecurring = signal(false);

  loyaltyBalance = signal(0);
  loyaltyEnabled = signal(false);
  pointsToRedeem = signal(0);
  pointsDiscountAmount = computed(() =>
    this.loyaltyEnabled() ? +(this.pointsToRedeem() / 10).toFixed(2) : 0
  );
  pointsEarned = signal(0);
  newLoyaltyBalance = signal(0);

  promoCode = signal('');
  promoResult = signal<PromoResult | null>(null);
  promoLoading = signal(false);
  promoError = signal('');
  promoDiscountAmount = computed(() => this.promoResult()?.discount_amount ?? 0);

  minDate = new Date().toISOString().split('T')[0];

  get effectiveMinDate(): string {
    const now = new Date();
    if (now.getHours() >= 15) {
      const t = new Date(now);
      t.setDate(t.getDate() + 1);
      return t.toISOString().split('T')[0];
    }
    return this.minDate;
  }

  formatSelectedDate(d: string): string {
    if (!d) return '';
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US',
      { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  get availableTimeSlots(): { value: string; label: string }[] {
    const all = [
      { value: '09:00', label: '9:00 AM – 11:00 AM' },
      { value: '11:00', label: '11:00 AM – 1:00 PM' },
      { value: '13:00', label: '1:00 PM – 3:00 PM' },
      { value: '15:00', label: '3:00 PM – 5:00 PM' },
      { value: '17:00', label: '5:00 PM – 7:00 PM' },
    ];
    if (this.formData.deliveryDate === this.minDate) {
      const h = new Date().getHours();
      return all.filter(s => parseInt(s.value) > h + 1);
    }
    return all;
  }

  get isScheduleComplete(): boolean {
    return this.deliveryType() === 'scheduled'
      && !!this.formData.deliveryDate
      && !!this.formData.deliveryTime;
  }

  get annualRecurrenceDisplay(): string {
    if (!this.formData.deliveryDate) return '';
    try {
      const d = new Date(this.formData.deliveryDate + 'T12:00:00');
      d.setFullYear(d.getFullYear() + 1);
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch { return ''; }
  }

  selectImmediate(): void {
    this.deliveryType.set('immediate');
    this.formData.deliveryDate = '';
    this.formData.deliveryTime = '';
    this.isRecurring.set(false);
  }

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
    private confetti: ConfettiService,
    private loyaltyService: LoyaltyService,
    private promoService: PromoService
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

      this.loyaltyService.getAccount(user.email).subscribe({
        next: data => this.loyaltyBalance.set(data.points_balance),
        error: () => {}
      });
    }

    // Auto-apply pending promo from sessionStorage (e.g. set by bundle flow)
    const pending = sessionStorage.getItem('floran_promo');
    if (pending) {
      this.promoCode.set(pending);
      sessionStorage.removeItem('floran_promo');
      setTimeout(() => this.applyPromo(), 100);
    }
  }

  getShipping(): number {
    return this.cartService.cartTotal() >= 50 ? 0 : 9.99;
  }

  getTotal(): number {
    return this.cartService.cartTotal() + this.getShipping() - this.pointsDiscountAmount() - this.promoDiscountAmount();
  }

  applyPromo(): void {
    const code = this.promoCode().trim();
    if (!code) return;
    this.promoLoading.set(true);
    this.promoError.set('');
    this.promoResult.set(null);
    const preDiscountTotal = this.cartService.cartTotal() + this.getShipping() - this.pointsDiscountAmount();
    const user = this.authService.user();
    this.promoService.validateCode(code, preDiscountTotal, user?.email).subscribe({
      next: (result) => {
        this.promoLoading.set(false);
        this.promoResult.set(result);
      },
      error: (err) => {
        this.promoLoading.set(false);
        this.promoError.set(err?.error?.detail ?? 'Invalid promo code');
      }
    });
  }

  clearPromo(): void {
    this.promoCode.set('');
    this.promoResult.set(null);
    this.promoError.set('');
  }

  get maxRedeemable(): number {
    const cap = Math.floor(this.getTotal() * 0.20) * 10;
    return Math.min(this.loyaltyBalance(), cap);
  }

  clampAndSetPoints(value: number): void {
    this.pointsToRedeem.set(Math.min(this.maxRedeemable, Math.max(0, value)));
  }

  togglePoints(): void {
    this.loyaltyEnabled.set(!this.loyaltyEnabled());
    if (!this.loyaltyEnabled()) {
      this.pointsToRedeem.set(0);
    } else {
      this.pointsToRedeem.set(this.maxRedeemable);
    }
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
      delivery_datetime: deliveryDatetime,
      points_redeemed: this.loyaltyEnabled() ? this.pointsToRedeem() : 0,
      promo_code: this.promoResult()?.code ?? undefined,
      is_recurring: this.isRecurring(),
      recurrence_type: this.isRecurring() ? 'annual' : null,
    };

    this.http.post<{ orderId: string; status: string; points_earned?: number; new_balance?: number }>(`${environment.apiUrl}/api/orders`, payload).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.orderNumber.set(res.orderId);
        this.pointsEarned.set(res.points_earned ?? 0);
        this.newLoyaltyBalance.set(res.new_balance ?? 0);
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
