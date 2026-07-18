import { Component, OnInit, computed, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth';
import { CorporateService, CreateCorporateOrderRequest } from '../../services/corporate';
import { ToastService } from '../../services/toast';
import { ProductService } from '../../services/product';
import { Product } from '../../models/product.model';
import { FormsModule } from '@angular/forms';
import { DatePicker } from '../date-picker/date-picker';

@Component({
  selector: 'app-corporate-order',
  imports: [RouterLink, FormsModule, DatePicker],
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

  // Step 1 — Event & Contact
  eventType = signal('');
  companyName = signal('');
  contactName = signal('');
  contactEmail = signal('');
  contactPhone = signal('');
  venueName = signal('');
  readonly eventTypes = ['Wedding', 'Function / Party', 'Hotel', 'Mall', 'House Party', 'Corporate', 'Other'];

  // Step 2 — Items & delivery (one-off event booking)
  selectedItems = signal<{ product: Product; quantity: number }[]>([]);
  deliveryAddress = signal('');
  deliveryDate = signal('');

  // Step 3 — Theme & Personalisation
  theme = signal('');
  brandingLogoUrl = signal('');
  brandingMessage = signal('');
  logoPreviewError = signal(false);
  readonly themeOptions = ['Classic White', 'Romantic Pink', 'Royal Red', 'Rustic', 'Tropical', 'Pastel', 'Vibrant Mix'];

  allProducts: Product[] = [];

  readonly MIN_UNITS = 5;
  readonly MAX_UNITS = 500;

  totalQuantity = computed(() => this.selectedItems().reduce((s, it) => s + it.quantity, 0));

  discountPct = computed(() => {
    const q = this.totalQuantity();
    if (q >= 50) return 15;
    if (q >= 25) return 10;
    if (q >= 10) return 5;
    return 0;
  });

  subtotal = computed(() => this.selectedItems().reduce((s, it) => s + it.product.price * it.quantity, 0));

  savings = computed(() => Math.round(this.subtotal() * this.discountPct()) / 100);

  total = computed(() => +(this.subtotal() - this.savings()).toFixed(2));

  isSelected(id: string): boolean { return this.selectedItems().some(it => it.product.id === id); }

  toggleProduct(product: Product): void {
    this.selectedItems.update(list =>
      list.some(it => it.product.id === product.id)
        ? list.filter(it => it.product.id !== product.id)
        : [...list, { product, quantity: 10 }]);
  }

  removeItem(id: string): void {
    this.selectedItems.update(list => list.filter(it => it.product.id !== id));
  }

  itemQty(id: string): number { return this.selectedItems().find(it => it.product.id === id)?.quantity ?? 0; }

  setItemQty(id: string, val: number): void {
    const q = Math.max(1, Math.min(this.MAX_UNITS, Math.round(val || 0)));
    this.selectedItems.update(list => list.map(it => it.product.id === id ? { ...it, quantity: q } : it));
  }

  adjustItemQty(id: string, delta: number): void { this.setItemQty(id, this.itemQty(id) + delta); }

  get isStep1Valid(): boolean {
    return this.eventType().trim().length > 0 &&
      this.contactName().trim().length >= 2 &&
      this.contactEmail().trim().includes('@');
  }

  selectEventType(t: string): void { this.eventType.set(t); }
  selectTheme(t: string): void { this.theme.set(this.theme() === t ? '' : t); }

  get isStep2Valid(): boolean {
    if (this.selectedItems().length === 0) return false;
    if (this.totalQuantity() < this.MIN_UNITS) return false;
    if (this.totalQuantity() > this.MAX_UNITS) return false;
    if (!this.deliveryAddress().trim()) return false;
    if (!this.deliveryDate()) return false;
    return true;
  }

  get isStep3Valid(): boolean { return true; }

  get minDate(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return this.ymd(d);
  }

  // Event-date selection is handled by the shared <app-date-picker> component.
  private ymd(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

  private scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  nextStep(): void {
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

  onLogoLoad(): void { this.logoPreviewError.set(false); }
  onLogoError(): void { this.logoPreviewError.set(true); }

  submit(): void {
    if (!this.isStep2Valid) return;
    this.submitting.set(true);
    this.error.set('');

    const req: CreateCorporateOrderRequest = {
      company_name: this.companyName().trim() || undefined,
      event_type: this.eventType() || undefined,
      theme: this.theme() || undefined,
      contact_name: this.contactName().trim(),
      contact_email: this.contactEmail().trim(),
      items: this.selectedItems().map(it => ({
        product_id: it.product.id,
        product_name: it.product.name,
        unit_price: it.product.price,
        quantity: it.quantity,
      })),
      branding_logo_url: this.brandingLogoUrl().trim() || undefined,
      branding_message: this.brandingMessage().trim() || undefined,
      delivery_address: this.deliveryAddress().trim(),
      delivery_date: this.deliveryDate(),
    };

    this.corporateService.create(req).subscribe({
      next: (res) => {
        this.createdId.set(res.id);
        this.createdFinalAmount.set(res.final_amount);
        this.createdNextDelivery.set(res.next_delivery ?? '');
        this.submitting.set(false);
        this.submitted.set(true);
        this.toastService.show('Petal Studio booking placed!');
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
