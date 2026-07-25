import { Component, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { retry } from 'rxjs/operators';
import { DecimalPipe } from '@angular/common';
import { AuthService } from '../../services/auth';
import { ToastService } from '../../services/toast';
import { ConfirmService } from '../../services/confirm';
import { NoticeService } from '../../services/notice';
import { environment } from '../../../environments/environment';
import { DatePicker } from '../date-picker/date-picker';
import { LocationPicker, PickedLocation } from '../location-picker/location-picker';

type MerchantSection = 'overview' | 'products' | 'orders' | 'analytics' | 'settings';

@Component({
  selector: 'app-merchant-dashboard',
  imports: [RouterLink, FormsModule, DatePicker, DecimalPipe, LocationPicker],
  templateUrl: './merchant-dashboard.html',
  styleUrl: './merchant-dashboard.scss',
})
export class MerchantDashboard implements OnInit {
  readonly STATUS_LABELS: Record<string, string> = {
    confirmed: 'Confirmed', preparing: 'Preparing',
    out_for_delivery: 'Out for Delivery', delivered: 'Delivered', cancelled: 'Cancelled',
  };

  activeSection = signal<MerchantSection>('overview');

  readonly BASE_CATEGORIES = ['Flowers', 'Bouquets', 'Garlands', 'Gifts', 'Decoration'];
  categories = signal<string[]>(this.BASE_CATEGORIES);

  stats = signal<any>(null);
  loadingStats = signal(true);
  statsError = signal(false);
  products = signal<any[]>([]);
  orders = signal<any[]>([]);

  loadingProducts = signal(false);
  loadingOrders = signal(false);
  updatingOrder = signal<string | null>(null);

  // product editor
  editingProduct = signal<any | null>(null);
  showProductForm = signal(false);
  productForm: any = this.blankProduct();

  // shop settings
  shop = {
    shop_name: '', description: '', phone: '', logo: '', address: '', city: '', state: '', pincode: '',
    latitude: null as number | null, longitude: null as number | null,
    max_delivery_km: null as number | null,
  };
  savingShop = signal(false);
  loadingShop = signal(false);
  shopLoaded = signal(false);

  // Shop availability — a quick on/off switch, always visible in the
  // sidebar (not tucked away in Settings), since the whole point is to
  // stop new orders from routing in while a merchant is genuinely away.
  shopIsOpen = signal(true);
  togglingAvailability = signal(false);

  // payout details
  payout = {
    payout_method: 'upi' as 'upi' | 'bank',
    upi_id: '', bank_account_name: '', bank_account_number: '', bank_ifsc: '',
  };
  payoutVerified = signal(false);
  savingPayout = signal(false);

  // analytics
  analytics = signal<any>(null);
  loadingAnalytics = signal(false);
  analyticsRange = signal(30);
  chartBars = signal<{ date: string; label: string; revenue: number; heightPct: number }[]>([]);

  onShopLocationPicked(loc: PickedLocation): void {
    this.shop.latitude = loc.latitude;
    this.shop.longitude = loc.longitude;
    if (loc.address) this.shop.address = loc.address;
    if (loc.city) this.shop.city = loc.city;
    if (loc.state) this.shop.state = loc.state;
    if (loc.pincode) this.shop.pincode = loc.pincode;
  }

  notifOpen = signal(false);

  constructor(
    private http: HttpClient,
    public auth: AuthService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private router: Router,
    public noticeService: NoticeService,
  ) {}

  toggleNotif(): void {
    const next = !this.notifOpen();
    this.notifOpen.set(next);
    if (next) this.noticeService.load();
  }

  private get token(): string { return this.auth.getToken(); }
  private get api(): string { return environment.apiUrl; }

  ngOnInit(): void {
    const m = this.auth.merchant();
    if (m) this.shop.shop_name = m.shop_name || '';
    this.loadStats();
    this.loadProducts();
    this.loadCategories();
    this.loadShop(); // also seeds shopIsOpen for the always-visible sidebar toggle
  }

  toggleAvailability(): void {
    const next = !this.shopIsOpen();
    this.togglingAvailability.set(true);
    this.http.put<any>(`${this.api}/api/merchant/availability`, { token: this.token, is_open: next }).subscribe({
      next: () => {
        this.shopIsOpen.set(next);
        this.togglingAvailability.set(false);
        this.toast.show(next ? "You're open — new orders can reach you again" : "You're marked closed — new orders will skip your shop");
      },
      error: (err) => { this.togglingAvailability.set(false); this.toast.show(err?.error?.detail || 'Could not update availability', 'error'); },
    });
  }

  // Storefront categories (live products) merged with a sensible base list,
  // so the dropdown always has options even before any products exist.
  loadCategories(): void {
    this.http.get<string[]>(`${this.api}/api/products/categories`).subscribe({
      next: (cats) => this.categories.set(Array.from(new Set([...this.BASE_CATEGORIES, ...(cats || [])]))),
      error: () => {},
    });
  }

  go(section: MerchantSection): void {
    this.activeSection.set(section);
    if (section === 'orders' && !this.orders().length) this.loadOrders();
    if (section === 'settings') this.loadShop();
    if (section === 'analytics') this.loadAnalytics();
  }

  loadAnalytics(): void {
    this.loadingAnalytics.set(true);
    this.http.get<any>(`${this.api}/api/merchant/analytics?token=${this.token}&days=${this.analyticsRange()}`).subscribe({
      next: (data) => {
        this.analytics.set(data);
        this.loadingAnalytics.set(false);
        const series: any[] = data?.series || [];
        const maxRevenue = Math.max(1, ...series.map((r) => r.revenue));
        this.chartBars.set(series.map((r) => ({
          date: r.date,
          label: new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
          revenue: r.revenue,
          heightPct: Math.max(4, Math.round((r.revenue / maxRevenue) * 100)),
        })));
      },
      error: () => { this.loadingAnalytics.set(false); },
    });
  }

  setAnalyticsRange(days: number): void {
    this.analyticsRange.set(days);
    this.loadAnalytics();
  }

  // ── Data ────────────────────────────────────────────────────────────────
  loadStats(): void {
    this.loadingStats.set(true);
    this.statsError.set(false);
    this.http.get<any>(`${this.api}/api/merchant/stats?token=${this.token}`)
      .pipe(retry({ count: 5, delay: 5000 }))
      .subscribe({
        next: (s) => { this.stats.set(s); this.loadingStats.set(false); },
        error: () => { this.loadingStats.set(false); this.statsError.set(true); },
      });
  }

  loadProducts(): void {
    this.loadingProducts.set(true);
    this.http.get<any[]>(`${this.api}/api/merchant/products?token=${this.token}`)
      .pipe(retry({ count: 5, delay: 5000 }))
      .subscribe({
        next: (p) => { this.products.set(p || []); this.loadingProducts.set(false); },
        error: () => { this.loadingProducts.set(false); },
      });
  }

  loadOrders(): void {
    this.loadingOrders.set(true);
    this.http.get<any[]>(`${this.api}/api/merchant/orders?token=${this.token}`)
      .pipe(retry({ count: 5, delay: 5000 }))
      .subscribe({
        next: (o) => { this.orders.set(o || []); this.loadingOrders.set(false); },
        error: () => { this.loadingOrders.set(false); },
      });
  }

  loadShop(): void {
    this.loadingShop.set(true);
    this.http.get<any>(`${this.api}/api/merchant/me?token=${this.token}`).subscribe({
      next: (res) => {
        const m = res?.merchant;
        if (m) {
          this.shop = {
            shop_name: m.shop_name || '', description: m.description || '', phone: m.phone || '', logo: m.logo || '',
            address: m.address || '', city: m.city || '', state: m.state || '', pincode: m.pincode || '',
            latitude: m.latitude ?? null, longitude: m.longitude ?? null,
            max_delivery_km: m.max_delivery_km ?? null,
          };
          this.payout = {
            payout_method: m.payout_method || 'upi',
            upi_id: m.payout_upi_id || '', bank_account_name: m.payout_bank_account_name || '',
            bank_account_number: m.payout_bank_account_number || '', bank_ifsc: m.payout_bank_ifsc || '',
          };
          this.payoutVerified.set(!!m.payout_verified);
          this.shopIsOpen.set(m.is_open !== false);
        }
        this.loadingShop.set(false);
        this.shopLoaded.set(true);
      },
      error: () => { this.loadingShop.set(false); this.shopLoaded.set(true); },
    });
  }

  savePayout(): void {
    if (this.payout.payout_method === 'upi' && !this.payout.upi_id.trim()) {
      this.toast.show('Please enter your UPI ID', 'error');
      return;
    }
    if (this.payout.payout_method === 'bank' && (!this.payout.bank_account_name.trim() || !this.payout.bank_account_number.trim() || !this.payout.bank_ifsc.trim())) {
      this.toast.show('Account holder name, account number and IFSC code are all required', 'error');
      return;
    }
    this.savingPayout.set(true);
    this.http.put<any>(`${this.api}/api/merchant/payout`, { token: this.token, ...this.payout }).subscribe({
      next: () => { this.savingPayout.set(false); this.payoutVerified.set(false); this.toast.show('Payout details saved — pending admin verification', 'success'); },
      error: (err) => { this.savingPayout.set(false); this.toast.show(err?.error?.detail || 'Save failed', 'error'); },
    });
  }

  readonly STATUS_INFO: Record<string, { label: string; cls: string }> = {
    pending: { label: 'Pending review', cls: 'pending' },
    approved: { label: 'Live', cls: 'approved' },
    rejected: { label: 'Rejected', cls: 'rejected' },
  };

  // ── Products ──────────────────────────────────────────────────────────────
  blankProduct(): any {
    return { name: '', description: '', merchant_price: null, image: '', category: this.categories()[0] || '', inStock: true };
  }

  newProduct(): void {
    this.editingProduct.set(null);
    this.productForm = this.blankProduct();
    this.showProductForm.set(true);
  }

  editProduct(p: any): void {
    this.editingProduct.set(p);
    this.productForm = {
      name: p.name, description: p.description, merchant_price: p.merchant_price,
      image: p.image, category: p.category, inStock: p.inStock,
    };
    this.showProductForm.set(true);
  }

  closeProductForm(): void { this.showProductForm.set(false); this.editingProduct.set(null); }

  /** Catalog items (admin-assigned, shared across merchants): stock is the
   * only thing a merchant may change — price/name/etc are admin-controlled. */
  toggleStock(p: any): void {
    const inStock = !p.inStock;
    this.http.put(`${this.api}/api/merchant/products/${p.id}`, { token: this.token, inStock }).subscribe({
      next: () => { p.inStock = inStock; this.toast.show(inStock ? `${p.name} marked in stock` : `${p.name} marked out of stock`, 'success'); },
      error: (err) => this.toast.show(err?.error?.detail || 'Update failed', 'error'),
    });
  }

  uploadingImage = signal(false);

  uploadProductImage(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploadingImage.set(true);
    const form = new FormData();
    form.append('file', file);
    this.http.post<{ url: string }>(`${this.api}/api/merchant/upload?token=${this.token}&category=${encodeURIComponent(this.productForm.category || 'uploads')}`, form).subscribe({
      next: (res) => { this.productForm.image = res.url; this.uploadingImage.set(false); },
      error: (err) => { this.uploadingImage.set(false); this.toast.show(err?.error?.detail || 'Upload failed', 'error'); },
    });
    input.value = '';
  }

  saveProduct(): void {
    if (!this.productForm.name?.trim() || !this.productForm.category?.trim() || this.productForm.merchant_price == null) {
      this.toast.show('Name, category and your price are required', 'error');
      return;
    }
    const editing = this.editingProduct();
    const body = { token: this.token, ...this.productForm, merchant_price: Number(this.productForm.merchant_price) };
    const req = editing
      ? this.http.put<any>(`${this.api}/api/merchant/products/${editing.id}`, body)
      : this.http.post<any>(`${this.api}/api/merchant/products`, body);
    req.subscribe({
      next: () => {
        this.toast.show(editing ? 'Saved — sent for admin review if price changed' : 'Product submitted for admin approval', 'success');
        this.closeProductForm();
        this.loadProducts();
        this.loadStats();
      },
      error: (err) => this.toast.show(err?.error?.detail || 'Save failed', 'error'),
    });
  }

  async deleteProduct(p: any): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Delete product',
      message: `Delete "${p.name}"? This cannot be undone.`,
      confirmText: 'Delete', danger: true,
    });
    if (!ok) return;
    this.http.delete(`${this.api}/api/merchant/products/${p.id}?token=${this.token}`).subscribe({
      next: () => { this.toast.show('Product deleted', 'success'); this.loadProducts(); this.loadStats(); },
      error: (err) => this.toast.show(err?.error?.detail || 'Delete failed', 'error'),
    });
  }

  // ── Orders ──────────────────────────────────────────────────────────────
  setOrderStatus(o: any, status: string): void {
    this.updatingOrder.set(o.order_id);
    this.http.patch(`${this.api}/api/merchant/orders/${o.order_id}/status`, { token: this.token, status }).subscribe({
      next: () => {
        this.updatingOrder.set(null);
        this.toast.show(`Order ${o.order_id} → ${this.STATUS_LABELS[status] || status}`, 'success');
        this.loadOrders();
        this.loadStats();
      },
      error: (err) => { this.updatingOrder.set(null); this.toast.show(err?.error?.detail || 'Update failed', 'error'); },
    });
  }

  setDeliveryDate(o: any, date: string): void {
    this.http.patch(`${this.api}/api/merchant/orders/${o.order_id}/status`, { token: this.token, status: o.status, delivery_date: date }).subscribe({
      next: () => { o.delivery_date = date; this.toast.show('Delivery date updated', 'success'); },
      error: (err) => this.toast.show(err?.error?.detail || 'Update failed', 'error'),
    });
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  saveShop(): void {
    if (!this.shop.shop_name.trim()) { this.toast.show('Shop name is required', 'error'); return; }
    this.savingShop.set(true);
    this.http.put<any>(`${this.api}/api/merchant/shop`, { token: this.token, ...this.shop }).subscribe({
      next: () => { this.savingShop.set(false); this.toast.show('Shop updated', 'success'); },
      error: (err) => { this.savingShop.set(false); this.toast.show(err?.error?.detail || 'Save failed', 'error'); },
    });
  }

  itemCount(o: any): number { return (o.items || []).reduce((n: number, it: any) => n + it.quantity, 0); }
}
