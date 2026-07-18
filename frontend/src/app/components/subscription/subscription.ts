import { Component, OnInit, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth';
import { SubscriptionService, CreateSubscriptionRequest, SubscriptionItem } from '../../services/subscription';
import { ToastService } from '../../services/toast';
import { ProductService } from '../../services/product';
import { Product } from '../../models/product.model';
import { environment } from '../../../environments/environment';

interface DurationOption {
  id: 'weekly' | 'biweekly' | 'monthly';
  label: string;
  subtitle: string;
  days: number;
  discount: number;
}

interface ProductSelection {
  product: Product;
  weight: number;       // for Flowers (kg)
  size: string;         // for Bouquets (small/medium/large)
  quantity: number;     // for Garlands, Decoration, Gifts
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
  selectedStyle = signal<'florist' | 'custom' | null>(null);
  floristBudget = signal<number>(500);
  selections = signal<ProductSelection[]>([]);
  activeCategory = signal<string>('All');

  name = signal('');
  email = signal('');
  phone = signal('');
  address = signal('');
  instructions = signal('');

  // Defaults shown instantly; overwritten by /api/subscription-plans in ngOnInit.
  durations: DurationOption[] = [
    {
      id: 'weekly',
      label: 'Weekly',
      subtitle: 'Fresh flowers every day for 1 week',
      days: 7,
      discount: 0,
    },
    {
      id: 'biweekly',
      label: 'Bi-Weekly',
      subtitle: 'Fresh flowers every day for 2 weeks',
      days: 14,
      discount: 10,
    },
    {
      id: 'monthly',
      label: 'Monthly',
      subtitle: 'Fresh flowers every day for 1 full month',
      days: 30,
      discount: 20,
    },
  ];

  readonly weightOptions = [
    { value: 0.1, label: '100g' },
    { value: 0.25, label: '250g' },
    { value: 0.5, label: '500g' },
    { value: 1, label: '1 kg' },
    { value: 2, label: '2 kg' },
    { value: 3, label: '3 kg' },
    { value: 5, label: '5 kg' },
  ];

  readonly budgetOptions = [200, 300, 500, 750, 1000, 1500, 2000];
  readonly sizeOptions = [
    { id: 'small', label: 'Small', multiplier: 0.7 },
    { id: 'medium', label: 'Medium', multiplier: 1.0 },
    { id: 'large', label: 'Large', multiplier: 1.4 },
  ];

  allProducts: Product[] = [];
  categories: string[] = [];

  get selectedDurationOption(): DurationOption | null {
    return this.durations.find(d => d.id === this.selectedDuration()) ?? null;
  }

  get filteredProducts(): Product[] {
    if (this.activeCategory() === 'All') return this.allProducts;
    return this.allProducts.filter(p => p.category === this.activeCategory());
  }

  isProductSelected(productId: string): boolean {
    return this.selections().some(s => s.product.id === productId);
  }

  getSelection(productId: string): ProductSelection | undefined {
    return this.selections().find(s => s.product.id === productId);
  }

  getInputType(category: string): 'weight' | 'size' | 'quantity' {
    if (category === 'Flowers') return 'weight';
    if (category === 'Bouquets') return 'size';
    return 'quantity';
  }

  getInputLabel(category: string): string {
    if (category === 'Flowers') return 'Weight (kg)';
    if (category === 'Bouquets') return 'Size';
    return 'Quantity';
  }

  getItemDailyCost(sel: ProductSelection): number {
    const cat = sel.product.category;
    if (cat === 'Flowers') {
      return Math.round(sel.product.price * sel.weight);
    } else if (cat === 'Bouquets') {
      const opt = this.sizeOptions.find(s => s.id === sel.size);
      return Math.round(sel.product.price * (opt?.multiplier ?? 1));
    } else {
      return Math.round(sel.product.price * sel.quantity);
    }
  }

  get dailySubtotal(): number {
    if (this.selectedStyle() === 'florist') return this.floristBudget();
    return this.selections().reduce((sum, sel) => sum + this.getItemDailyCost(sel), 0);
  }

  get discountPercent(): number {
    return this.selectedDurationOption?.discount ?? 0;
  }

  get dailyTotal(): number {
    const subtotal = this.dailySubtotal;
    return Math.round(subtotal * (1 - this.discountPercent / 100));
  }

  get grandTotal(): number {
    const dur = this.selectedDurationOption;
    if (!dur) return 0;
    return this.dailyTotal * dur.days;
  }

  get discountAmount(): number {
    const dur = this.selectedDurationOption;
    if (!dur) return 0;
    return (this.dailySubtotal - this.dailyTotal) * dur.days;
  }

  get isStep1Valid(): boolean { return !!this.selectedDuration(); }

  get isStep2Valid(): boolean {
    if (!this.selectedStyle()) return false;
    if (this.selectedStyle() === 'florist') return this.floristBudget() > 0;
    return this.selections().length > 0;
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
    private http: HttpClient,
  ) {}

  ngOnInit(): void {
    const user = this.authService.user();
    if (user) {
      this.name.set(user.firstName ?? '');
      this.email.set(user.email ?? '');
    }
    this.allProducts = this.productService.getProducts().filter(p => p.inStock);
    this.categories = ['All', ...this.productService.getCategories()];
    this.loadPlans();
  }

  private loadPlans(): void {
    this.http.get<any[]>(`${environment.apiUrl}/api/subscription-plans`).subscribe({
      next: (plans) => {
        if (plans?.length) {
          this.durations = plans.map(p => ({
            id: p.id, label: p.label, subtitle: p.subtitle,
            days: p.days, discount: p.discount_percent,
          }));
        }
      },
      error: () => {} // keep hardcoded defaults on failure
    });
  }

  private scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  nextStep(): void {
    if (!this.authService.isLoggedIn()) {
      this.toastService.show('Please sign in to continue', 'error');
      this.router.navigate(['/signin'], { queryParams: { returnUrl: '/subscribe' } });
      return;
    }
    const cur = this.step();
    if (cur < 4) { this.step.set((cur + 1) as 1 | 2 | 3 | 4); this.scrollToTop(); }
  }

  prevStep(): void {
    const cur = this.step();
    if (cur > 1) { this.step.set((cur - 1) as 1 | 2 | 3 | 4); this.scrollToTop(); }
  }

  goToStep(n: number): void {
    if (n < this.step()) { this.step.set(n as 1 | 2 | 3 | 4); this.scrollToTop(); }
  }

  selectDuration(id: 'weekly' | 'biweekly' | 'monthly'): void {
    this.selectedDuration.set(id);
  }

  selectStyle(style: 'florist' | 'custom'): void {
    this.selectedStyle.set(style);
  }

  setBudget(amount: number): void {
    this.floristBudget.set(amount);
  }

  setCategory(cat: string): void {
    this.activeCategory.set(cat);
  }

  toggleProduct(product: Product): void {
    const current = this.selections();
    const exists = current.findIndex(s => s.product.id === product.id);
    if (exists >= 0) {
      this.selections.set(current.filter(s => s.product.id !== product.id));
    } else {
      const newSel: ProductSelection = {
        product,
        weight: 0.5,
        size: 'medium',
        quantity: 1,
      };
      this.selections.set([...current, newSel]);
    }
  }

  updateWeight(productId: string, weight: number): void {
    this.selections.update(list =>
      list.map(s => s.product.id === productId ? { ...s, weight } : s)
    );
  }

  updateSize(productId: string, size: string): void {
    this.selections.update(list =>
      list.map(s => s.product.id === productId ? { ...s, size } : s)
    );
  }

  updateQuantity(productId: string, qty: number): void {
    if (qty < 1) qty = 1;
    if (qty > 50) qty = 50;
    this.selections.update(list =>
      list.map(s => s.product.id === productId ? { ...s, quantity: qty } : s)
    );
  }

  formatWeight(kg: number): string {
    if (kg < 1) return `${Math.round(kg * 1000)}g`;
    return `${kg} kg`;
  }

  submit(): void {
    if (!this.isStep3Valid || !this.selectedDuration() || !this.isStep2Valid) return;
    this.submitting.set(true);
    this.error.set('');

    const items: SubscriptionItem[] = this.selectedStyle() === 'florist'
      ? []
      : this.selections().map(sel => ({
          product_id: sel.product.id,
          product_name: sel.product.name,
          category: sel.product.category,
          weight_kg: sel.product.category === 'Flowers' ? sel.weight : undefined,
          size: sel.product.category === 'Bouquets' ? sel.size : undefined,
          quantity: !['Flowers', 'Bouquets'].includes(sel.product.category) ? sel.quantity : undefined,
          daily_cost: this.getItemDailyCost(sel),
        }));

    const req: CreateSubscriptionRequest = {
      customer_email: this.email().trim(),
      customer_name: this.name().trim(),
      customer_phone: this.phone().trim(),
      plan: this.selectedDuration()!,
      items,
      address: this.address().trim(),
      instructions: this.instructions().trim() || undefined,
      daily_total: this.dailyTotal,
      grand_total: this.grandTotal,
      discount_percent: this.discountPercent,
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
