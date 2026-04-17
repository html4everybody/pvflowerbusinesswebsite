import { Component, OnInit, signal, computed, effect } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth';
import { ToastService } from '../../services/toast';
import { environment } from '../../../environments/environment';

export type AdminSection = 'overview' | 'orders' | 'products' | 'inventory' | 'customers' | 'analytics' | 'zones';

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

  // ── Stats ──────────────────────────────────────────────────────────────────
  stats = signal<any>(null);
  lastRefreshed = signal<Date | null>(null);

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

  constructor(
    private authService: AuthService,
    private http: HttpClient,
    private router: Router,
    private toastService: ToastService
  ) {
    effect(() => sessionStorage.setItem('admin_section', this.activeSection()));
    effect(() => sessionStorage.setItem('admin_tab', this.activeTab()));
  }

  ngOnInit(): void {
    if (!this.authService.isLoggedIn()) { this.router.navigate(['/signin']); return; }
    if (!this.authService.isAdmin()) { this.router.navigate(['/']); return; }
    this.loadStats();
    this.loadOrders();
    // If restored section needs lazy-loaded data, trigger it
    const section = this.activeSection();
    if (section === 'products' && !this.products().length) this.loadProducts();
    if (section === 'inventory' && !this.inventory().length) this.loadInventory();
    if (section === 'customers' && !this.customers().length) this.loadCustomers();
    if (section === 'analytics' && !this.analytics()) this.loadAnalytics();
    if (section === 'zones' && !this.zones().length) this.loadZones();
  }

  get token(): string { return this.authService.getToken(); }

  navigateTo(section: AdminSection): void {
    this.activeSection.set(section);
    if (section === 'products' && !this.products().length) this.loadProducts();
    if (section === 'inventory' && !this.inventory().length) this.loadInventory();
    if (section === 'customers' && !this.customers().length) this.loadCustomers();
    if (section === 'analytics' && !this.analytics()) this.loadAnalytics();
    if (section === 'zones' && !this.zones().length) this.loadZones();
  }

  // ── Stats & Orders ────────────────────────────────────────────────────────
  loadStats(): void {
    this.http.get<any>(`${environment.apiUrl}/api/admin/stats?token=${this.token}`).subscribe({
      next: (s) => { this.stats.set(s); this.lastRefreshed.set(new Date()); },
      error: () => {}
    });
  }

  loadOrders(): void {
    this.loadingOrders.set(true);
    this.loadError.set('');
    this.http.get<any[]>(`${environment.apiUrl}/api/admin/orders?token=${this.token}`).subscribe({
      next: (data) => { this.orders.set(data); this.loadingOrders.set(false); },
      error: (err) => {
        this.loadingOrders.set(false);
        if (err.status === 401) this.loadError.set('Session expired. Please log out and back in.');
        else if (err.status === 403) this.loadError.set('Access denied. Admin access required.');
        else this.loadError.set('Could not load orders. Please refresh.');
      }
    });
  }

  refresh(): void {
    this.loadStats();
    this.loadOrders();
  }

  updateStatus(order: any, newStatus: string): void {
    this.updatingId.set(order.id);
    this.http.patch<{ status: string }>(`${environment.apiUrl}/api/orders/${order.id}/status`, { status: newStatus }).subscribe({
      next: (res) => {
        this.orders.update(list => list.map(o => o.id === order.id ? { ...o, status: res.status } : o));
        this.loadStats();
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

  deleteZone(zone: any): void {
    if (!confirm(`Delete zone "${zone.zone_name}"?`)) return;
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
