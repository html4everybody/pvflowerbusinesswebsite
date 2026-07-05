import { Component, OnInit, signal, computed, effect } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth';
import { ToastService } from '../../services/toast';
import { ConfirmService } from '../../services/confirm';
import { environment } from '../../../environments/environment';

export type AdminSection = 'overview' | 'orders' | 'products' | 'inventory' | 'customers' | 'analytics' | 'zones' | 'deals' | 'bundles' | 'plans';

@Component({
  selector: 'app-admin',
  imports: [RouterLink, FormsModule],
  templateUrl: './admin.html',
  styleUrl: './admin.scss'
})
export class Admin implements OnInit {
  readonly STATUS_ORDER = ['confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'] as const;
  readonly STATUS_LABELS: Record<string, string> = {
    confirmed: 'Confirmed', preparing: 'Preparing',
    out_for_delivery: 'Out for Delivery', delivered: 'Delivered', cancelled: 'Cancelled'
  };
  readonly NEXT_STATUSES: Record<string, string[]> = {
    confirmed: ['preparing', 'out_for_delivery', 'delivered'],
    preparing: ['out_for_delivery', 'delivered'],
    out_for_delivery: ['delivered'],
    delivered: [], cancelled: []
  };

  activeSection = signal<AdminSection>((sessionStorage.getItem('admin_section') as AdminSection) || 'overview');

  // ── Stats (derived from orders, no extra API call) ─────────────────────────
  lastRefreshed = signal<Date | null>(null);
  statsReady = computed(() => !this.loadingOrders() && this.orders().length > 0);
  stats = computed(() => {
    const list = this.orders();
    const today = new Date().toISOString().slice(0, 10);
    return {
      total_orders:   list.length,
      today_orders:   list.filter(o => (o.created_at ?? '').startsWith(today)).length,
      pending_count:  list.filter(o => o.status === 'confirmed' || o.status === 'preparing').length,
      revenue_total:  Math.round(list.filter(o => o.status !== 'cancelled').reduce((s, o) => s + (o.total ?? 0), 0) * 100) / 100,
      revenue_today:  Math.round(list.filter(o => o.status !== 'cancelled' && (o.created_at ?? '').startsWith(today)).reduce((s, o) => s + (o.total ?? 0), 0) * 100) / 100,
    };
  });

  // ── Orders ─────────────────────────────────────────────────────────────────
  orders = signal<any[]>([]);
  loadingOrders = signal(true);
  loadError = signal('');
  activeTab = signal(sessionStorage.getItem('admin_tab') || 'all');
  updatingId = signal<string | null>(null);
  searchQuery = signal('');
  selectedDate = signal('');

  visibleOrders = computed(() => {
    const tab = this.activeTab();
    const q = this.searchQuery().trim().toLowerCase();
    const date = this.selectedDate();
    let list = tab === 'all' ? this.orders() : this.orders().filter(o => o.status === tab);
    if (q) list = list.filter(o =>
      (o.id || '').toLowerCase().includes(q) ||
      (o.customer_name || '').toLowerCase().includes(q) ||
      (o.customer_email || '').toLowerCase().includes(q)
    );
    if (date) list = list.filter(o => (o.created_at || '').startsWith(date));
    return list;
  });

  tabCount = computed(() => {
    const all = this.orders();
    const counts: Record<string, number> = { all: all.length };
    for (const o of all) counts[o.status] = (counts[o.status] || 0) + 1;
    return counts;
  });

  readonly tabs = [
    { key: 'all', label: 'All' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'preparing', label: 'Preparing' },
    { key: 'out_for_delivery', label: 'Out for Delivery' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'cancelled', label: 'Cancelled' },
  ];

  // ── Products ───────────────────────────────────────────────────────────────
  products = signal<any[]>([]);
  loadingProducts = signal(true);
  productSearch = signal('');
  filteredProducts = computed(() => {
    const q = this.productSearch().toLowerCase();
    return q ? this.products().filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)) : this.products();
  });
  readonly PRODUCT_CATEGORIES = ['Flowers', 'Bouquets', 'Garlands', 'Gifts', 'Decoration'];
  productCategories = computed(() => {
    const fromData = Array.from(new Set(this.products().map(p => p.category).filter(Boolean)));
    return Array.from(new Set([...this.PRODUCT_CATEGORIES, ...fromData]));
  });
  showProductForm = signal(false);
  editingProduct = signal<any | null>(null);
  savingProduct = signal(false);
  productForm = { name: '', description: '', price: 0, image: '', category: 'Flowers', inStock: true };

  // ── Subscription Plans ───────────────────────────────────────────────────────
  subPlans = signal<any[]>([]);
  loadingPlans = signal(true);
  editingPlan = signal<string | null>(null);
  editPlanForm = { label: '', subtitle: '', discount_percent: 0 };
  savingPlan = signal(false);

  // ── Inventory ──────────────────────────────────────────────────────────────
  inventory = signal<any[]>([]);
  loadingInventory = signal(true);
  inventorySearch = signal('');
  editingStock = signal<number | null>(null);
  editStockValue = 0;
  lowStockOnly = signal(false);
  filteredInventory = computed(() => {
    const q = this.inventorySearch().toLowerCase();
    let list = this.inventory();
    if (this.lowStockOnly()) list = list.filter(p => p.low_stock);
    if (q) list = list.filter(p => p.name.toLowerCase().includes(q));
    return list;
  });

  // ── Customers ──────────────────────────────────────────────────────────────
  customers = signal<any[]>([]);
  loadingCustomers = signal(true);
  customerSearch = signal('');
  filteredCustomers = computed(() => {
    const q = this.customerSearch().toLowerCase();
    return q ? this.customers().filter(c =>
      (c.first_name + ' ' + c.last_name).toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    ) : this.customers();
  });

  // ── Analytics ─────────────────────────────────────────────────────────────
  analytics = signal<any>(null);
  loadingAnalytics = signal(true);

  // ── Delivery Zones ────────────────────────────────────────────────────────
  zones = signal<any[]>([]);
  loadingZones = signal(true);
  showZoneForm = signal(false);
  editingZone = signal<any | null>(null);
  zoneForm = { zone_name: '', areas: '', delivery_charge: 0, min_order: 0, active: true };
  savingZone = signal(false);

  // ── Live Deals (Promo Codes + Seasonal Offers) ────────────────────────────
  promoCodes = signal<any[]>([]);
  seasonalOffers = signal<any[]>([]);
  loadingDeals = signal(true);
  showPromoForm = signal(false);
  editingPromo = signal<any | null>(null);
  promoForm = { code: '', type: 'percent', value: 0, description: '', first_order_only: false, min_order: 0, active: true };
  savingPromo = signal(false);
  showOfferForm = signal(false);
  editingOffer = signal<any | null>(null);
  offerForm = { emoji: '', title: '', subtitle: '', code: '', badge: '' };
  savingOffer = signal(false);

  // ── Bundle Offers ────────────────────────────────────────────────────────
  bundleDeals = signal<any[]>([]);
  loadingBundles = signal(true);
  showBundleForm = signal(false);
  editingBundle = signal<any | null>(null);
  bundleForm = { name: '', description: '', emoji: '', product_ids: '' as string, promo_code: '', savings_pct: 15 };
  savingBundle = signal(false);

  constructor(
    private authService: AuthService,
    private http: HttpClient,
    private router: Router,
    private toastService: ToastService,
    private confirmService: ConfirmService
  ) {
    effect(() => sessionStorage.setItem('admin_section', this.activeSection()));
    effect(() => sessionStorage.setItem('admin_tab', this.activeTab()));
  }

  ngOnInit(): void {
    if (!this.authService.isLoggedIn()) { this.router.navigate(['/signin']); return; }
    if (!this.authService.isAdmin()) { this.router.navigate(['/']); return; }
    this.loadOrders();
    // If restored section needs lazy-loaded data, trigger it
    const section = this.activeSection();
    if (section === 'products' && !this.products().length) this.loadProducts();
    if (section === 'inventory' && !this.inventory().length) this.loadInventory();
    if (section === 'customers' && !this.customers().length) this.loadCustomers();
    if (section === 'analytics' && !this.analytics()) this.loadAnalytics();
    if (section === 'zones' && !this.zones().length) this.loadZones();
    if (section === 'deals') this.loadDeals();
    if (section === 'bundles') this.loadBundles();
    if (section === 'plans' && !this.subPlans().length) this.loadPlans();
  }

  get token(): string { return this.authService.getToken(); }

  navigateTo(section: AdminSection): void {
    this.activeSection.set(section);
    if (section === 'products' && !this.products().length) this.loadProducts();
    if (section === 'inventory' && !this.inventory().length) this.loadInventory();
    if (section === 'customers' && !this.customers().length) this.loadCustomers();
    if (section === 'analytics' && !this.analytics()) this.loadAnalytics();
    if (section === 'zones' && !this.zones().length) this.loadZones();
    if (section === 'deals') this.loadDeals();
    if (section === 'bundles') this.loadBundles();
    if (section === 'plans' && !this.subPlans().length) this.loadPlans();
  }

  // ── Stats & Orders ────────────────────────────────────────────────────────
  loadOrders(): void {
    this.loadingOrders.set(true);
    this.loadError.set('');
    this.http.get<any[]>(`${environment.apiUrl}/api/admin/orders?token=${this.token}`).subscribe({
      next: (data) => { this.orders.set(data); this.loadingOrders.set(false); this.lastRefreshed.set(new Date()); },
      error: (err) => {
        this.loadingOrders.set(false);
        if (err.status === 401) this.loadError.set('Session expired. Please log out and back in.');
        else if (err.status === 403) this.loadError.set('Access denied. Admin access required.');
        else this.loadError.set('Could not load orders. Please refresh.');
      }
    });
  }

  refresh(): void {
    this.loadOrders();
  }

  updateStatus(order: any, newStatus: string): void {
    this.updatingId.set(order.id);
    this.http.patch<{ status: string }>(`${environment.apiUrl}/api/orders/${order.id}/status`, { status: newStatus }).subscribe({
      next: (res) => {
        this.orders.update(list => list.map(o => o.id === order.id ? { ...o, status: res.status } : o));
        this.updatingId.set(null);
        this.toastService.show(`Order ${order.id} → ${this.STATUS_LABELS[res.status]}`);
      },
      error: () => { this.updatingId.set(null); this.toastService.show('Could not update status.'); }
    });
  }

  // ── Products ──────────────────────────────────────────────────────────────
  loadProducts(): void {
    this.loadingProducts.set(true);
    this.http.get<any[]>(`${environment.apiUrl}/api/products`).subscribe({
      next: (data) => { this.products.set(data || []); this.loadingProducts.set(false); },
      error: () => this.loadingProducts.set(false)
    });
  }

  openProductForm(product: any = null): void {
    this.editingProduct.set(product);
    this.productForm = product
      ? { name: product.name, description: product.description || '', price: product.price, image: product.image || '', category: product.category, inStock: product.inStock !== false }
      : { name: '', description: '', price: 0, image: '', category: this.productCategories()[0] || 'Flowers', inStock: true };
    this.showProductForm.set(true);
  }

  closeProductForm(): void { this.showProductForm.set(false); this.editingProduct.set(null); }

  saveProduct(): void {
    if (!this.productForm.name.trim() || !this.productForm.category.trim()) return;
    this.savingProduct.set(true);
    const editing = this.editingProduct();
    const url = editing
      ? `${environment.apiUrl}/api/admin/products/${editing.id}?token=${this.token}`
      : `${environment.apiUrl}/api/admin/products?token=${this.token}`;
    const req = editing
      ? this.http.put(url, this.productForm)
      : this.http.post(url, this.productForm);
    req.subscribe({
      next: () => { this.savingProduct.set(false); this.closeProductForm(); this.loadProducts(); this.toastService.show(editing ? 'Product updated' : 'Product added'); },
      error: (err) => { this.savingProduct.set(false); this.toastService.show(err.error?.detail || 'Failed to save product', 'error'); }
    });
  }

  async deleteProduct(product: any): Promise<void> {
    const ok = await this.confirmService.ask({
      title: 'Delete product?',
      message: `"${product.name}" will be permanently removed. This can't be undone.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    this.http.delete(`${environment.apiUrl}/api/admin/products/${product.id}?token=${this.token}`).subscribe({
      next: () => { this.products.update(list => list.filter(p => p.id !== product.id)); this.toastService.show('Product deleted'); },
      error: (err) => this.toastService.show(err.error?.detail || 'Failed to delete product', 'error')
    });
  }

  // ── Subscription Plans ────────────────────────────────────────────────────
  loadPlans(): void {
    this.loadingPlans.set(true);
    this.http.get<any[]>(`${environment.apiUrl}/api/admin/subscription-plans?token=${this.token}`).subscribe({
      next: (data) => { this.subPlans.set(data || []); this.loadingPlans.set(false); },
      error: () => this.loadingPlans.set(false)
    });
  }

  startEditPlan(plan: any): void {
    this.editingPlan.set(plan.id);
    this.editPlanForm = { label: plan.label, subtitle: plan.subtitle, discount_percent: plan.discount_percent };
  }

  savePlan(plan: any): void {
    this.savingPlan.set(true);
    this.http.put(`${environment.apiUrl}/api/admin/subscription-plans/${plan.id}?token=${this.token}`, this.editPlanForm).subscribe({
      next: (updated: any) => {
        this.subPlans.update(list => list.map(p => p.id === plan.id ? updated : p));
        this.editingPlan.set(null);
        this.savingPlan.set(false);
        this.toastService.show('Plan updated');
      },
      error: (err) => { this.savingPlan.set(false); this.toastService.show(err.error?.detail || 'Failed to update plan', 'error'); }
    });
  }

  // ── Inventory ────────────────────────────────────────────────────────────
  loadInventory(): void {
    this.loadingInventory.set(true);
    this.http.get<any[]>(`${environment.apiUrl}/api/admin/inventory?token=${this.token}`).subscribe({
      next: (data) => { this.inventory.set(data || []); this.loadingInventory.set(false); },
      error: () => this.loadingInventory.set(false)
    });
  }

  startEditStock(item: any): void {
    this.editingStock.set(item.id);
    this.editStockValue = item.stock;
  }

  saveStock(item: any): void {
    this.http.patch(`${environment.apiUrl}/api/admin/inventory/${item.id}?token=${this.token}`, { stock: this.editStockValue }).subscribe({
      next: () => {
        this.inventory.update(list => list.map(p => p.id === item.id ? { ...p, stock: this.editStockValue, low_stock: this.editStockValue < 10 } : p));
        this.editingStock.set(null);
        this.toastService.show('Stock updated');
      },
      error: () => this.toastService.show('Failed to update stock', 'error')
    });
  }

  // ── Customers ────────────────────────────────────────────────────────────
  loadCustomers(): void {
    this.loadingCustomers.set(true);
    this.http.get<any[]>(`${environment.apiUrl}/api/admin/customers?token=${this.token}`).subscribe({
      next: (data) => { this.customers.set(data || []); this.loadingCustomers.set(false); },
      error: () => this.loadingCustomers.set(false)
    });
  }

  // ── Analytics ────────────────────────────────────────────────────────────
  loadAnalytics(): void {
    this.loadingAnalytics.set(true);
    this.http.get<any>(`${environment.apiUrl}/api/admin/analytics?token=${this.token}`).subscribe({
      next: (data) => { this.analytics.set(data); this.loadingAnalytics.set(false); },
      error: () => this.loadingAnalytics.set(false)
    });
  }

  get revenueChartPath(): string {
    const data = this.analytics()?.revenue_chart;
    if (!data || data.length === 0) return '';
    const maxRev = Math.max(...data.map((d: any) => d.revenue), 1);
    const w = 700, h = 140, pad = 10;
    const points = data.map((d: any, i: number) => {
      const x = pad + (i / (data.length - 1)) * (w - pad * 2);
      const y = h - pad - (d.revenue / maxRev) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M${points.join(' L')}`;
  }

  get revenueAreaPath(): string {
    const path = this.revenueChartPath;
    if (!path) return '';
    const data = this.analytics()?.revenue_chart;
    const w = 700, h = 140, pad = 10;
    const lastX = (pad + (1) * (w - pad * 2)).toFixed(1);
    return `${path} L${(w - pad).toFixed(1)},${h} L${pad},${h} Z`;
  }

  get maxRevenue(): number {
    const data = this.analytics()?.revenue_chart;
    if (!data) return 0;
    return Math.max(...data.map((d: any) => d.revenue));
  }

  get maxPeakCount(): number {
    const data = this.analytics()?.peak_hours;
    if (!data) return 1;
    return Math.max(...data.map((d: any) => d.count), 1);
  }

  get maxTopProductRevenue(): number {
    const data = this.analytics()?.top_products;
    if (!data || data.length === 0) return 1;
    return Math.max(...data.map((d: any) => d.revenue), 1);
  }

  // ── Delivery Zones ───────────────────────────────────────────────────────
  loadZones(): void {
    this.loadingZones.set(true);
    this.http.get<any[]>(`${environment.apiUrl}/api/admin/delivery-zones?token=${this.token}`).subscribe({
      next: (data) => { this.zones.set(data || []); this.loadingZones.set(false); },
      error: () => this.loadingZones.set(false)
    });
  }

  openZoneForm(zone: any = null): void {
    this.editingZone.set(zone);
    if (zone) {
      this.zoneForm = { zone_name: zone.zone_name, areas: zone.areas, delivery_charge: zone.delivery_charge, min_order: zone.min_order, active: zone.active };
    } else {
      this.zoneForm = { zone_name: '', areas: '', delivery_charge: 0, min_order: 0, active: true };
    }
    this.showZoneForm.set(true);
  }

  closeZoneForm(): void {
    this.showZoneForm.set(false);
    this.editingZone.set(null);
  }

  saveZone(): void {
    if (!this.zoneForm.zone_name.trim()) return;
    this.savingZone.set(true);
    const zone = this.editingZone();
    if (zone) {
      this.http.patch(`${environment.apiUrl}/api/admin/delivery-zones/${zone.id}?token=${this.token}`, this.zoneForm).subscribe({
        next: (updated) => {
          this.zones.update(list => list.map(z => z.id === zone.id ? updated : z));
          this.savingZone.set(false);
          this.closeZoneForm();
          this.toastService.show('Zone updated');
        },
        error: () => { this.savingZone.set(false); this.toastService.show('Failed to save zone', 'error'); }
      });
    } else {
      this.http.post(`${environment.apiUrl}/api/admin/delivery-zones?token=${this.token}`, this.zoneForm).subscribe({
        next: (created: any) => {
          this.zones.update(list => [...list, created]);
          this.savingZone.set(false);
          this.closeZoneForm();
          this.toastService.show('Zone created');
        },
        error: () => { this.savingZone.set(false); this.toastService.show('Failed to create zone', 'error'); }
      });
    }
  }

  async deleteZone(zone: any): Promise<void> {
    const ok = await this.confirmService.ask({
      title: 'Delete delivery zone?',
      message: `"${zone.zone_name}" will be removed from your delivery areas.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    this.http.delete(`${environment.apiUrl}/api/admin/delivery-zones/${zone.id}?token=${this.token}`).subscribe({
      next: () => {
        this.zones.update(list => list.filter(z => z.id !== zone.id));
        this.toastService.show('Zone deleted');
      },
      error: () => this.toastService.show('Failed to delete zone', 'error')
    });
  }

  toggleZoneActive(zone: any): void {
    this.http.patch(`${environment.apiUrl}/api/admin/delivery-zones/${zone.id}?token=${this.token}`, { active: !zone.active }).subscribe({
      next: (updated: any) => this.zones.update(list => list.map(z => z.id === zone.id ? updated : z)),
      error: () => this.toastService.show('Failed to update zone', 'error')
    });
  }

  // ── Live Deals (Promo Codes + Seasonal Offers) ───────────────────────────
  loadDeals(): void {
    this.loadingDeals.set(true);
    const t = this.token;
    this.http.get<any[]>(`${environment.apiUrl}/api/admin/promo-codes?token=${t}`).subscribe({
      next: (codes) => {
        this.promoCodes.set(codes || []);
        this.http.get<any[]>(`${environment.apiUrl}/api/admin/seasonal-offers?token=${t}`).subscribe({
          next: (offers) => { this.seasonalOffers.set(offers || []); this.loadingDeals.set(false); },
          error: () => this.loadingDeals.set(false)
        });
      },
      error: () => this.loadingDeals.set(false)
    });
  }

  openPromoForm(promo: any = null): void {
    this.editingPromo.set(promo);
    this.promoForm = promo
      ? { code: promo.code, type: promo.type, value: promo.value, description: promo.description, first_order_only: promo.first_order_only, min_order: promo.min_order, active: promo.active }
      : { code: '', type: 'percent', value: 0, description: '', first_order_only: false, min_order: 0, active: true };
    this.showPromoForm.set(true);
  }

  closePromoForm(): void { this.showPromoForm.set(false); this.editingPromo.set(null); }

  savePromo(): void {
    if (!this.promoForm.code.trim()) return;
    this.savingPromo.set(true);
    const editing = this.editingPromo();
    const url = editing
      ? `${environment.apiUrl}/api/admin/promo-codes/${editing.code}?token=${this.token}`
      : `${environment.apiUrl}/api/admin/promo-codes?token=${this.token}`;
    const req$ = editing
      ? this.http.put(url, this.promoForm)
      : this.http.post(url, this.promoForm);
    req$.subscribe({
      next: () => { this.savingPromo.set(false); this.closePromoForm(); this.loadDeals(); this.toastService.show(editing ? 'Promo updated' : 'Promo created'); },
      error: (err) => { this.savingPromo.set(false); this.toastService.show(err.error?.detail || 'Failed to save promo', 'error'); }
    });
  }

  async deletePromo(promo: any): Promise<void> {
    const ok = await this.confirmService.ask({
      title: 'Delete promo code?',
      message: `Code "${promo.code}" will stop working for customers immediately.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    this.http.delete(`${environment.apiUrl}/api/admin/promo-codes/${promo.code}?token=${this.token}`).subscribe({
      next: () => { this.promoCodes.update(list => list.filter(p => p.code !== promo.code)); this.toastService.show('Promo deleted'); },
      error: () => this.toastService.show('Failed to delete promo', 'error')
    });
  }

  openOfferForm(offer: any = null): void {
    this.editingOffer.set(offer);
    this.offerForm = offer
      ? { emoji: offer.emoji, title: offer.title, subtitle: offer.subtitle, code: offer.code, badge: offer.badge }
      : { emoji: '', title: '', subtitle: '', code: '', badge: '' };
    this.showOfferForm.set(true);
  }

  closeOfferForm(): void { this.showOfferForm.set(false); this.editingOffer.set(null); }

  saveOffer(): void {
    if (!this.offerForm.title.trim()) return;
    this.savingOffer.set(true);
    const editing = this.editingOffer();
    const url = editing
      ? `${environment.apiUrl}/api/admin/seasonal-offers/${editing.id}?token=${this.token}`
      : `${environment.apiUrl}/api/admin/seasonal-offers?token=${this.token}`;
    const req$ = editing
      ? this.http.put(url, this.offerForm)
      : this.http.post(url, this.offerForm);
    req$.subscribe({
      next: () => { this.savingOffer.set(false); this.closeOfferForm(); this.loadDeals(); this.toastService.show(editing ? 'Offer updated' : 'Offer created'); },
      error: (err) => { this.savingOffer.set(false); this.toastService.show(err.error?.detail || 'Failed to save offer', 'error'); }
    });
  }

  async deleteOffer(offer: any): Promise<void> {
    const ok = await this.confirmService.ask({
      title: 'Delete live deal?',
      message: `"${offer.title}" will be removed from the home page.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    this.http.delete(`${environment.apiUrl}/api/admin/seasonal-offers/${offer.id}?token=${this.token}`).subscribe({
      next: () => { this.seasonalOffers.update(list => list.filter(o => o.id !== offer.id)); this.toastService.show('Offer deleted'); },
      error: () => this.toastService.show('Failed to delete offer', 'error')
    });
  }

  // ── Bundle Offers ───────────────────────────────────────────────────────
  loadBundles(): void {
    this.loadingBundles.set(true);
    // Also load promo codes for the dropdown in bundle form
    if (!this.promoCodes().length) {
      this.http.get<any[]>(`${environment.apiUrl}/api/admin/promo-codes?token=${this.token}`).subscribe({
        next: (codes) => this.promoCodes.set(codes || []),
        error: () => {}
      });
    }
    this.http.get<any[]>(`${environment.apiUrl}/api/admin/bundle-deals?token=${this.token}`).subscribe({
      next: (data) => { this.bundleDeals.set(data || []); this.loadingBundles.set(false); },
      error: () => this.loadingBundles.set(false)
    });
  }

  openBundleForm(bundle: any = null): void {
    this.editingBundle.set(bundle);
    this.bundleForm = bundle
      ? { name: bundle.name, description: bundle.description, emoji: bundle.emoji, product_ids: bundle.product_ids.join(', '), promo_code: bundle.promo_code, savings_pct: bundle.savings_pct }
      : { name: '', description: '', emoji: '', product_ids: '', promo_code: '', savings_pct: 15 };
    this.showBundleForm.set(true);
  }

  closeBundleForm(): void { this.showBundleForm.set(false); this.editingBundle.set(null); }

  saveBundle(): void {
    if (!this.bundleForm.name.trim()) return;
    this.savingBundle.set(true);
    const ids = this.bundleForm.product_ids.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    const payload = { ...this.bundleForm, product_ids: ids };
    const editing = this.editingBundle();
    const url = editing
      ? `${environment.apiUrl}/api/admin/bundle-deals/${editing.id}?token=${this.token}`
      : `${environment.apiUrl}/api/admin/bundle-deals?token=${this.token}`;
    const req$ = editing
      ? this.http.put(url, payload)
      : this.http.post(url, payload);
    req$.subscribe({
      next: () => { this.savingBundle.set(false); this.closeBundleForm(); this.loadBundles(); this.toastService.show(editing ? 'Bundle updated' : 'Bundle created'); },
      error: (err) => { this.savingBundle.set(false); this.toastService.show(err.error?.detail || 'Failed to save bundle', 'error'); }
    });
  }

  async deleteBundle(bundle: any): Promise<void> {
    const ok = await this.confirmService.ask({
      title: 'Delete bundle?',
      message: `"${bundle.name}" will be removed from the home page.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    this.http.delete(`${environment.apiUrl}/api/admin/bundle-deals/${bundle.id}?token=${this.token}`).subscribe({
      next: () => { this.bundleDeals.update(list => list.filter(b => b.id !== bundle.id)); this.toastService.show('Bundle deleted'); },
      error: () => this.toastService.show('Failed to delete bundle', 'error')
    });
  }

  // ── Utilities ────────────────────────────────────────────────────────────
  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Kolkata' });
  }

  formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  }

  formatRefreshed(): string {
    const d = this.lastRefreshed();
    return d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' }) : '';
  }

  formatHour(h: number): string {
    const suffix = h < 12 ? 'am' : 'pm';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}${suffix}`;
  }

  clearDate(): void { this.selectedDate.set(''); }

  itemCount(order: any): number { return (order.items || []).length; }
}
