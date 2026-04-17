import { Component, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth';
import { SubscriptionService, CreateSubscriptionRequest } from '../../services/subscription';
import { ToastService } from '../../services/toast';
import { ProductService } from '../../services/product';
import { Product } from '../../models/product.model';

interface PlanOption {
  id: 'weekly' | 'biweekly' | 'monthly';
  label: string;
  frequency: string;
  priceLabel: string;
  saving?: string;
  popular?: boolean;
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

  selectedPlan = signal<'weekly' | 'biweekly' | 'monthly' | null>(null);
  selectedStyle = signal<'seasonal' | 'fixed' | null>(null);
  selectedProductId = signal<number | null>(null);

  name = signal('');
  email = signal('');
  address = signal('');

  readonly plans: PlanOption[] = [
    {
      id: 'weekly',
      label: 'Weekly',
      frequency: 'Every week',
      priceLabel: '₹799 / week',
    },
    {
      id: 'biweekly',
      label: 'Bi-Weekly',
      frequency: 'Every 2 weeks',
      priceLabel: '₹1,399 / delivery',
      saving: 'Save ₹199',
      popular: true,
    },
    {
      id: 'monthly',
      label: 'Monthly',
      frequency: 'Once a month',
      priceLabel: '₹2,199 / month',
      saving: 'Best value',
    },
  ];

  fixedProducts: Product[] = [];

  get selectedProduct(): Product | null {
    if (!this.selectedProductId()) return null;
    return this.fixedProducts.find(p => p.id === this.selectedProductId()) ?? null;
  }

  get selectedPlanOption(): PlanOption | null {
    return this.plans.find(p => p.id === this.selectedPlan()) ?? null;
  }

  get isStep1Valid(): boolean { return !!this.selectedPlan(); }

  get isStep2Valid(): boolean {
    if (!this.selectedStyle()) return false;
    if (this.selectedStyle() === 'fixed' && !this.selectedProductId()) return false;
    return true;
  }

  get isStep3Valid(): boolean {
    return this.name().trim().length >= 2 &&
      this.email().trim().includes('@') &&
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

  selectPlan(id: 'weekly' | 'biweekly' | 'monthly'): void {
    this.selectedPlan.set(id);
  }

  selectStyle(s: 'seasonal' | 'fixed'): void {
    this.selectedStyle.set(s);
    if (s === 'seasonal') this.selectedProductId.set(null);
  }

  toggleFixedProduct(id: number): void {
    this.selectedProductId.set(this.selectedProductId() === id ? null : id);
  }

  submit(): void {
    if (!this.isStep3Valid || !this.selectedPlan() || !this.selectedStyle()) return;
    this.submitting.set(true);
    this.error.set('');

    const req: CreateSubscriptionRequest = {
      customer_email: this.email().trim(),
      customer_name: this.name().trim(),
      plan: this.selectedPlan()!,
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
