import { Component, OnInit, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth';
import { SubscriptionService, CreateSubscriptionRequest } from '../../services/subscription';
import { ToastService } from '../../services/toast';
import { ProductService } from '../../services/product';
import { Product } from '../../models/product.model';

interface DurationOption {
  id: 'weekly' | 'biweekly' | 'monthly';
  days: number;
  perDay: number;
  popular?: boolean;
}

interface SizeOption {
  id: 'essential' | 'standard' | 'premium';
  label: string;
  stems: string;
  extraPerDay: number;
  icon: string;
  description: string;
}

@Component({
  selector: 'app-subscription',
  imports: [RouterLink],
  templateUrl: './subscription.html',
  styleUrl: './subscription.scss'
})
export class Subscription implements OnInit {
  step = signal<1 | 2 | 3 | 4>(1);
  submitting = signal(false);
  submitted = signal(false);
  error = signal('');
  nextDelivery = signal('');

  selectedDuration = signal<'weekly' | 'biweekly' | 'monthly' | null>(null);
  selectedSize = signal<'essential' | 'standard' | 'premium' | null>(null);
  selectedStyle = signal<'seasonal' | 'fixed' | null>(null);
  selectedProductId = signal<number | null>(null);

  name = signal('');
  email = signal('');
  address = signal('');
  phone = signal('');
  instructions = signal('');

  readonly durations: DurationOption[] = [
    { id: 'weekly', days: 7, perDay: 299 },
    { id: 'biweekly', days: 14, perDay: 249, popular: true },
    { id: 'monthly', days: 30, perDay: 199 },
  ];

  readonly sizes: SizeOption[] = [
    {
      id: 'essential',
      label: 'Essential',
      stems: '6–8 stems',
      extraPerDay: 0,
      icon: '🌱',
      description: 'A neat, everyday arrangement — perfect for desks, small tables, or pooja spaces.',
    },
    {
      id: 'standard',
      label: 'Standard',
      stems: '12–15 stems',
      extraPerDay: 100,
      icon: '🌷',
      description: 'A fuller, eye-catching bouquet — great for reception areas, dining tables, and gifting.',
    },
    {
      id: 'premium',
      label: 'Premium',
      stems: '20–25 stems',
      extraPerDay: 250,
      icon: '💐',
      description: 'A grand, show-stopping arrangement — designed for lobbies, events, and luxury spaces.',
    },
  ];

  fixedProducts: Product[] = [];

  get selectedProduct(): Product | null {
    if (!this.selectedProductId()) return null;
    return this.fixedProducts.find(p => p.id === this.selectedProductId()) ?? null;
  }

  get selectedDurationOption(): DurationOption | null {
    return this.durations.find(d => d.id === this.selectedDuration()) ?? null;
  }

  get selectedSizeOption(): SizeOption | null {
    return this.sizes.find(s => s.id === this.selectedSize()) ?? null;
  }

  get dailyRate(): number {
    const dur = this.selectedDurationOption;
    const size = this.selectedSizeOption;
    if (!dur || !size) return 0;
    return dur.perDay + size.extraPerDay;
  }

  get totalPrice(): number {
    const dur = this.selectedDurationOption;
    if (!dur) return 0;
    return this.dailyRate * dur.days;
  }

  get savingsPercent(): number {
    const dur = this.selectedDurationOption;
    const size = this.selectedSizeOption;
    if (!dur || !size) return 0;
    const weeklyRate = 299 + size.extraPerDay;
    if (dur.id === 'weekly') return 0;
    return Math.round((1 - this.dailyRate / weeklyRate) * 100);
  }

  get isStep1Valid(): boolean { return !!this.selectedDuration() && !!this.selectedSize(); }

  get isStep2Valid(): boolean {
    if (!this.selectedStyle()) return false;
    if (this.selectedStyle() === 'fixed' && !this.selectedProductId()) return false;
    return true;
  }

  get isStep3Valid(): boolean {
    return this.name().trim().length >= 2 &&
      this.email().trim().includes('@') &&
      this.phone().trim().length >= 10 &&
      this.address().trim().length >= 5;
  }

  constructor(
    private authService: AuthService,
    private subscriptionService: SubscriptionService,
    private toastService: ToastService,
    private productService: ProductService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    const user = this.authService.user();
    if (user) {
      this.name.set(user.firstName ?? '');
      this.email.set(user.email ?? '');
    }
    this.fixedProducts = this.productService.getProducts().filter(p => p.inStock).slice(0, 18);
  }

  nextStep(): void {
    const cur = this.step();
    if (cur < 4) this.step.set((cur + 1) as 1 | 2 | 3 | 4);
  }

  prevStep(): void {
    const cur = this.step();
    if (cur > 1) this.step.set((cur - 1) as 1 | 2 | 3 | 4);
  }

  goToStep(n: number): void {
    if (n < this.step()) this.step.set(n as 1 | 2 | 3 | 4);
  }

  selectDuration(id: 'weekly' | 'biweekly' | 'monthly'): void {
    this.selectedDuration.set(id);
  }

  selectSize(id: 'essential' | 'standard' | 'premium'): void {
    this.selectedSize.set(id);
  }

  selectStyle(s: 'seasonal' | 'fixed'): void {
    this.selectedStyle.set(s);
    if (s === 'seasonal') this.selectedProductId.set(null);
  }

  toggleFixedProduct(id: number): void {
    this.selectedProductId.set(this.selectedProductId() === id ? null : id);
  }

  getDailyRateFor(dur: DurationOption): number {
    const size = this.selectedSizeOption;
    return dur.perDay + (size?.extraPerDay ?? 0);
  }

  getTotalFor(dur: DurationOption): number {
    return this.getDailyRateFor(dur) * dur.days;
  }

  submit(): void {
    if (!this.isStep3Valid || !this.selectedDuration() || !this.selectedStyle()) return;
    this.submitting.set(true);
    this.error.set('');

    const req: CreateSubscriptionRequest = {
      customer_email: this.email().trim(),
      customer_name: this.name().trim(),
      plan: this.selectedDuration()!,
      style: this.selectedStyle()!,
      fixed_product_id: this.selectedProductId() ?? undefined,
      fixed_product_name: this.selectedProduct?.name,
      address: this.address().trim(),
    };

    this.subscriptionService.create(req).subscribe({
      next: (res) => {
        this.nextDelivery.set(res.next_delivery);
        this.submitting.set(false);
        this.submitted.set(true);
        this.toastService.show('Subscription created!');
      },
      error: () => {
        this.submitting.set(false);
        this.error.set('Something went wrong. Please try again.');
      }
    });
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }
}
