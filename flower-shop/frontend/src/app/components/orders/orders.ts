import { Component, OnInit, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-orders',
  imports: [RouterLink],
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
  activeTab = signal<'active' | 'cancelled'>('active');

  activeOrders = computed(() => this.orders().filter(o => o.status !== 'cancelled'));
  cancelledOrders = computed(() => this.orders().filter(o => o.status === 'cancelled'));
  visibleOrders = computed(() => this.activeTab() === 'active' ? this.activeOrders() : this.cancelledOrders());

  constructor(
    private authService: AuthService,
    private http: HttpClient,
    private router: Router
  ) {}

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
