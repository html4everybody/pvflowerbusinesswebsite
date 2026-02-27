import { Component, OnInit, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth';
import { ToastService } from '../../services/toast';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-orders',
  imports: [RouterLink],
  templateUrl: './orders.html',
  styleUrl: './orders.scss'
})
export class Orders implements OnInit {
  orders = signal<any[]>([]);
  loading = signal(true);
  cancellingId = signal<string | null>(null);
  cancelErrors = signal<Record<string, string>>({});
  activeTab = signal<'active' | 'cancelled'>('active');

  activeOrders = computed(() => this.orders().filter(o => o.status !== 'cancelled'));
  cancelledOrders = computed(() => this.orders().filter(o => o.status === 'cancelled'));
  visibleOrders = computed(() => this.activeTab() === 'active' ? this.activeOrders() : this.cancelledOrders());

  constructor(
    private authService: AuthService,
    private http: HttpClient,
    private router: Router,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    if (!this.authService.isLoggedIn()) {
      this.router.navigate(['/signin']);
      return;
    }

    const user = this.authService.user();
    this.http.get<any[]>(`${environment.apiUrl}/api/orders?email=${encodeURIComponent(user.email)}`).subscribe({
      next: (data) => {
        this.orders.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  cancelOrder(order: any): void {
    // Clear any previous error for this order
    this.cancelErrors.update(errs => ({ ...errs, [order.id]: '' }));

    if (order.status === 'shipping') {
      this.cancelErrors.update(errs => ({ ...errs, [order.id]: 'You cannot cancel this order as it is already being shipped.' }));
      return;
    }
    if (order.status === 'delivered') {
      this.cancelErrors.update(errs => ({ ...errs, [order.id]: 'You cannot cancel this order as it has already been delivered.' }));
      return;
    }

    this.cancellingId.set(order.id);
    this.http.patch(`${environment.apiUrl}/api/orders/${order.id}/cancel`, {}).subscribe({
      next: () => {
        this.orders.update(list =>
          list.map(o => o.id === order.id ? { ...o, status: 'cancelled' } : o)
        );
        this.cancellingId.set(null);
        this.toastService.show('Your order has been cancelled.');
      },
      error: () => {
        this.cancellingId.set(null);
        this.cancelErrors.update(errs => ({ ...errs, [order.id]: 'Something went wrong. Please try again.' }));
      }
    });
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }
}
