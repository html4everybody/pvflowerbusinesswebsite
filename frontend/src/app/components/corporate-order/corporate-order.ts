import { Component, OnInit, computed, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { UpperCasePipe } from '@angular/common';
import { AuthService } from '../../services/auth';
import { CorporateService, CreateCorporateOrderRequest } from '../../services/corporate';
import { ToastService } from '../../services/toast';
import { ProductService } from '../../services/product';
import { Product } from '../../models/product.model';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-corporate-order',
  imports: [RouterLink, FormsModule, UpperCasePipe],
  templateUrl: './corporate-order.html',
  styleUrl: './corporate-order.scss'
})
export class CorporateOrder implements OnInit {
  step = signal<1 | 2 | 3 | 4>(1);
  submitting = signal(false);
  submitted = signal(false);
  error = signal('');
  createdId = signal('');
  createdFinalAmount = signal(0);
  createdNextDelivery = signal('');

  // Step 1 — Company Details
  companyName = signal('');
  contactName = signal('');
  contactEmail = signal('');
  department = signal('');

  // Step 2 — Order Details
  selectedProductId = signal<number | null>(null);
  quantity = signal(10);
  deliveryAddress = signal('');
  deliveryDate = signal('');
  isRecurring = signal(false);
  recurringDay = signal('monday');
  recurringFrequency = signal<'weekly' | 'biweekly' | 'monthly'>('weekly');

  // Step 3 — Branding
  brandingLogoUrl = signal('');
  brandingMessage = signal('');
  logoPreviewError = signal(false);

  readonly weekdays = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  readonly frequencies: { id: 'weekly'|'biweekly'|'monthly'; label: string }[] = [
    { id: 'weekly', label: 'Weekly' },
    { id: 'biweekly', label: 'Bi-Weekly' },
    { id: 'monthly', label: 'Monthly' },
  ];

  allProducts: Product[] = [];

  get selectedProduct(): Product | null {
    if (!this.selectedProductId()) return null;
    return this.allProducts.find(p => p.id === this.selectedProductId()) ?? null;
  }

  discountPct = computed(() => {
    const q = this.quantity();
    if (q >= 50) return 15;
    if (q >= 25) return 10;
    if (q >= 10) return 5;
    return 0;
  });

  unitPrice = computed(() => this.selectedProduct?.price ?? 0);

  subtotal = computed(() => this.unitPrice() * this.quantity());

  savings = computed(() => Math.round(this.subtotal() * this.discountPct()) / 100);

  total = computed(() => +(this.subtotal() - this.savings()).toFixed(2));

  get isStep1Valid(): boolean {
    return this.companyName().trim().length >= 2 &&
      this.contactName().trim().length >= 2 &&
      this.contactEmail().trim().includes('@');
  }

  get isStep2Valid(): boolean {
    if (!this.selectedProductId()) return false;
    if (this.quantity() < 5) return false;
    if (!this.deliveryAddress().trim()) return false;
    if (!this.isRecurring() && !this.deliveryDate()) return false;
    if (this.isRecurring() && (!this.recurringDay() || !this.recurringFrequency())) return false;
    return true;
  }

  get isStep3Valid(): boolean { return true; }

  get minDate(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }

  constructor(
    private authService: AuthService,
    private corporateService: CorporateService,
    private toastService: ToastService,
    private productService: ProductService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    const user = this.authService.user();
    if (user) {
      this.contactName.set(`${user.firstName ?? ''} ${user.lastName ?? ''}`.trim());
      this.contactEmail.set(user.email ?? '');
    }
    this.allProducts = this.productService.getProducts().filter(p => p.inStock);
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

  selectProduct(id: number): void {
    this.selectedProductId.set(id);
  }

  adjustQty(delta: number): void {
    const next = Math.max(5, Math.min(500, this.quantity() + delta));
    this.quantity.set(next);
  }

  onQtyInput(val: string): void {
    const n = parseInt(val, 10);
    if (!isNaN(n)) this.quantity.set(Math.max(5, Math.min(500, n)));
  }

  onLogoLoad(): void { this.logoPreviewError.set(false); }
  onLogoError(): void { this.logoPreviewError.set(true); }

  submit(): void {
    if (!this.isStep2Valid || !this.selectedProduct) return;
    this.submitting.set(true);
    this.error.set('');

    const req: CreateCorporateOrderRequest = {
      company_name: this.companyName().trim(),
      contact_name: this.contactName().trim(),
      contact_email: this.contactEmail().trim(),
      product_id: this.selectedProductId()!,
      product_name: this.selectedProduct.name,
      unit_price: this.unitPrice(),
      quantity: this.quantity(),
      branding_logo_url: this.brandingLogoUrl().trim() || undefined,
      branding_message: this.brandingMessage().trim() || undefined,
      delivery_address: this.deliveryAddress().trim(),
      delivery_date: !this.isRecurring() ? this.deliveryDate() : undefined,
      is_recurring: this.isRecurring(),
      recurring_day: this.isRecurring() ? this.recurringDay() : undefined,
      recurring_frequency: this.isRecurring() ? this.recurringFrequency() : undefined,
    };

    this.corporateService.create(req).subscribe({
      next: (res) => {
        this.createdId.set(res.id);
        this.createdFinalAmount.set(res.final_amount);
        this.createdNextDelivery.set(res.next_delivery ?? '');
        this.submitting.set(false);
        this.submitted.set(true);
        this.toastService.show('Corporate order placed!');
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

  capitalize(s: string): string {
    return s ? s[0].toUpperCase() + s.slice(1) : '';
  }
}
