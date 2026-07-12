import { Component, OnInit, signal, computed, effect } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-orders',
  imports: [RouterLink, FormsModule],
  templateUrl: './orders.html',
  styleUrl: './orders.scss'
})
export class Orders implements OnInit {
  readonly STATUS_LABELS: Record<string, string> = {
    confirmed: 'Confirmed', preparing: 'Preparing',
    out_for_delivery: 'Out for Delivery', delivered: 'Delivered', cancelled: 'Cancelled'
  };

  orders = signal<any[]>([]);
  loading = signal(true);
  activeTab = signal<'active' | 'cancelled'>((sessionStorage.getItem('orders_tab') as 'active' | 'cancelled') || 'active');
  dateFilter = signal<string>('all');

  activeOrders = computed(() => this.orders().filter(o => o.status !== 'cancelled'));
  cancelledOrders = computed(() => this.orders().filter(o => o.status === 'cancelled'));

  availableYears = computed(() => {
    const years = new Set(this.orders().map(o => new Date(o.created_at).getFullYear()));
    return Array.from(years).sort((a, b) => b - a);
  });

  visibleOrders = computed(() => {
    const tab = this.activeTab() === 'active' ? this.activeOrders() : this.cancelledOrders();
    const filter = this.dateFilter();
    if (filter === 'all') return tab;
    const now = new Date();
    if (filter === 'last_month') {
      const cutoff = new Date(now); cutoff.setMonth(now.getMonth() - 1);
      return tab.filter(o => new Date(o.created_at) >= cutoff);
    }
    if (filter === 'last_3_months') {
      const cutoff = new Date(now); cutoff.setMonth(now.getMonth() - 3);
      return tab.filter(o => new Date(o.created_at) >= cutoff);
    }
    if (filter === 'last_6_months') {
      const cutoff = new Date(now); cutoff.setMonth(now.getMonth() - 6);
      return tab.filter(o => new Date(o.created_at) >= cutoff);
    }
    // year filter e.g. "2025"
    const year = parseInt(filter);
    if (!isNaN(year)) return tab.filter(o => new Date(o.created_at).getFullYear() === year);
    return tab;
  });

  constructor(
    private authService: AuthService,
    private http: HttpClient,
    private router: Router
  ) {
    effect(() => sessionStorage.setItem('orders_tab', this.activeTab()));
  }

  ngOnInit(): void {
    if (!this.authService.isLoggedIn()) {
      this.router.navigate(['/signin']);
      return;
    }
    const user = this.authService.user();
    this.http.get<any[]>(`${environment.apiUrl}/api/orders?email=${encodeURIComponent(user.email)}`).subscribe({
      next: (data) => { this.orders.set(data); this.loading.set(false); },
      error: () => { this.loading.set(false); }
    });
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata'
    });
  }

  itemCount(order: any): number {
    return (order.items || []).reduce((sum: number, i: any) => sum + i.quantity, 0);
  }
}
