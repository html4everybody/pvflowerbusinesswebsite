import { Component, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';
import { AuthService } from '../../services/auth';
import { ToastService } from '../../services/toast';
import { ConfirmService } from '../../services/confirm';
import { environment } from '../../../environments/environment';
import { DatePicker } from '../date-picker/date-picker';

type MerchantSection = 'overview' | 'products' | 'orders' | 'settings';

@Component({
  selector: 'app-merchant-dashboard',
  imports: [RouterLink, FormsModule, DatePicker, DecimalPipe],
  templateUrl: './merchant-dashboard.html',
  styleUrl: './merchant-dashboard.scss',
})
export class MerchantDashboard implements OnInit {
  readonly STATUS_LABELS: Record<string, string> = {
    confirmed: 'Confirmed', preparing: 'Preparing',
    out_for_delivery: 'Out for Delivery', delivered: 'Delivered', cancelled: 'Cancelled',
  };

  activeSection = signal<MerchantSection>('overview');

  stats = signal<any>(null);
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
  shop = { shop_name: '', description: '', phone: '', logo: '' };
  savingShop = signal(false);

  constructor(
    private http: HttpClient,
    public auth: AuthService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private router: Router,
  ) {}

  private get token(): string { return this.auth.getToken(); }
  private get api(): string { return environment.apiUrl; }

  ngOnInit(): void {
    const m = this.auth.merchant();
    if (m) this.shop.shop_name = m.shop_name || '';
    this.loadStats();
    this.loadProducts();
  }

  go(section: MerchantSection): void {
    this.activeSection.set(section);
    if (section === 'orders' && !this.orders().length) this.loadOrders();
    if (section === 'settings') this.loadShop();
  }

  // ── Data ────────────────────────────────────────────────────────────────
  loadStats(): void {
    this.http.get<any>(`${this.api}/api/merchant/stats?token=${this.token}`).subscribe({
      next: (s) => this.stats.set(s),
      error: () => {},
    });
  }

  loadProducts(): void {
    this.loadingProducts.set(true);
    this.http.get<any[]>(`${this.api}/api/merchant/products?token=${this.token}`).subscribe({
      next: (p) => { this.products.set(p || []); this.loadingProducts.set(false); },
      error: () => { this.loadingProducts.set(false); this.toast.show('Could not load products', 'error'); },
    });
  }

  loadOrders(): void {
    this.loadingOrders.set(true);
    this.http.get<any[]>(`${this.api}/api/merchant/orders?token=${this.token}`).subscribe({
      next: (o) => { this.orders.set(o || []); this.loadingOrders.set(false); },
      error: () => { this.loadingOrders.set(false); this.toast.show('Could not load orders', 'error'); },
    });
  }

  loadShop(): void {
    this.http.get<any>(`${this.api}/api/merchant/me?token=${this.token}`).subscribe({
      next: (res) => {
        const m = res?.merchant;
        if (m) this.shop = { shop_name: m.shop_name || '', description: m.description || '', phone: m.phone || '', logo: m.logo || '' };
      },
    });
  }

  readonly STATUS_INFO: Record<string, { label: string; cls: string }> = {
    pending: { label: 'Pending review', cls: 'pending' },
    approved: { label: 'Live', cls: 'approved' },
    rejected: { label: 'Rejected', cls: 'rejected' },
  };

  // ── Products ──────────────────────────────────────────────────────────────
  blankProduct(): any {
    return { name: '', description: '', merchant_price: null, image: '', category: '', inStock: true };
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
