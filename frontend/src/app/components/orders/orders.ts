import { Component, OnInit, signal, computed, effect } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth';
import { CartService } from '../../services/cart';
import { ProductService } from '../../services/product';
import { ToastService } from '../../services/toast';
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
  activeTab = signal<'active' | 'cancelled'>((sessionStorage.getItem('orders_tab') as 'active' | 'cancelled') || 'active');

  activeOrders = computed(() => this.orders().filter(o => o.status !== 'cancelled'));
  cancelledOrders = computed(() => this.orders().filter(o => o.status === 'cancelled'));
  visibleOrders = computed(() => this.activeTab() === 'active' ? this.activeOrders() : this.cancelledOrders());

  reorderingId = signal<string | null>(null);

  constructor(
    private authService: AuthService,
    private http: HttpClient,
    private router: Router,
    private cartService: CartService,
    private productService: ProductService,
    private toastService: ToastService
  ) {
    effect(() => sessionStorage.setItem('orders_tab', this.activeTab()));
  }

  ngOnInit(): void {
    if (!this.authService.isLoggedIn()) {
      this.router.navigate(['/signin']);
      return;
    }
    const user = this.authService.user();
    const token = this.authService.getToken();
    this.http.get<any[]>(`${environment.apiUrl}/api/orders?email=${encodeURIComponent(user.email)}&token=${encodeURIComponent(token)}`).subscribe({
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

  async reorder(order: any, event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (this.reorderingId()) return;
    this.reorderingId.set(order.id);

    if (this.productService.getProducts().length === 0) {
      await this.productService.loadProducts();
    }

    let added = 0;
    const unavailable: string[] = [];
    for (const item of (order.items || [])) {
      const product = this.productService.getProductById(item.product_id);
      if (product && product.inStock) {
        this.cartService.addToCart(product, item.quantity);
        added++;
      } else {
        unavailable.push(item.name);
      }
    }

    this.reorderingId.set(null);

    if (added === 0) {
      this.toastService.show('None of these items are available anymore.', 'error');
      return;
    }
    if (unavailable.length > 0) {
      this.toastService.show(
        `Added ${added} item${added !== 1 ? 's' : ''} to cart. Not available: ${unavailable.join(', ')}`, 'error'
      );
    } else {
      this.toastService.show(`${added} item${added !== 1 ? 's' : ''} added to cart!`);
    }
    this.router.navigate(['/cart']);
  }
}
