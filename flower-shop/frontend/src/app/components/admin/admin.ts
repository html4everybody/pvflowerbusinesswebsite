import { Component, OnInit, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth';
import { ToastService } from '../../services/toast';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-admin',
  imports: [RouterLink],
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
    delivered: [],
    cancelled: []
  };

  stats = signal<any>(null);
  orders = signal<any[]>([]);
  loading = signal(true);
  loadError = signal('');
  activeTab = signal('all');
  updatingId = signal<string | null>(null);
  lastRefreshed = signal<Date | null>(null);
  searchQuery = signal('');
  selectedDate = signal('');

  visibleOrders = computed(() => {
    const tab = this.activeTab();
    const q = this.searchQuery().trim().toLowerCase();
    const date = this.selectedDate();

    let list = tab === 'all' ? this.orders() : this.orders().filter(o => o.status === tab);

    if (q) {
      list = list.filter(o =>
        (o.id || '').toLowerCase().includes(q) ||
        (o.customer_name || '').toLowerCase().includes(q) ||
        (o.customer_email || '').toLowerCase().includes(q)
      );
    }

    if (date) {
      list = list.filter(o => (o.created_at || '').startsWith(date));
    }

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

  constructor(
    private authService: AuthService,
    private http: HttpClient,
    private router: Router,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    if (!this.authService.isLoggedIn()) { this.router.navigate(['/signin']); return; }
    if (!this.authService.isAdmin()) { this.router.navigate(['/']); return; }
    this.load();
  }

  get token(): string { return this.authService.getToken(); }

  load(): void {
    this.loading.set(true);
    this.loadError.set('');
    const base = environment.apiUrl;
    this.http.get<any>(`${base}/api/admin/stats?token=${this.token}`).subscribe({
      next: (s) => this.stats.set(s),
      error: () => {}
    });
    this.http.get<any[]>(`${base}/api/admin/orders?token=${this.token}`).subscribe({
      next: (data) => { this.orders.set(data); this.loading.set(false); this.lastRefreshed.set(new Date()); },
      error: (err) => {
        this.loading.set(false);
        if (err.status === 401) this.loadError.set('Session expired. Please log out and log back in.');
        else if (err.status === 403) this.loadError.set('Access denied. Make sure your account has admin access in Supabase.');
        else this.loadError.set('Could not load orders. Please try refreshing.');
      }
    });
  }

  updateStatus(order: any, newStatus: string): void {
    this.updatingId.set(order.id);
    this.http.patch<{ status: string }>(`${environment.apiUrl}/api/orders/${order.id}/status`, { status: newStatus }).subscribe({
      next: (res) => {
        this.orders.update(list => list.map(o => o.id === order.id ? { ...o, status: res.status } : o));
        if (this.stats()) {
          this.http.get<any>(`${environment.apiUrl}/api/admin/stats?token=${this.token}`).subscribe({ next: (s) => this.stats.set(s) });
        }
        this.updatingId.set(null);
        this.toastService.show(`Order ${order.id} → ${this.STATUS_LABELS[res.status]}`);
      },
      error: () => {
        this.updatingId.set(null);
        this.toastService.show('Could not update status.');
      }
    });
  }

  itemCount(order: any): number {
    return (order.items || []).length;
  }

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

  clearDate(): void {
    this.selectedDate.set('');
  }

}
