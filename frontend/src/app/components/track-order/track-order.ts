import { Component, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { TitleCasePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-track-order',
  imports: [FormsModule, TitleCasePipe],
  templateUrl: './track-order.html',
  styleUrl: './track-order.scss'
})
export class TrackOrder implements OnInit {
  readonly STATUS_LABELS: Record<string, string> = {
    confirmed: 'Order Confirmed',
    preparing: 'Preparing',
    out_for_delivery: 'Out for Delivery',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  };

  readonly STATUS_ICONS: Record<string, string> = {
    confirmed: 'bi-check-circle-fill',
    preparing: 'bi-flower1',
    out_for_delivery: 'bi-truck',
    delivered: 'bi-balloon-heart-fill',
    cancelled: 'bi-x-circle-fill',
  };

  readonly STATUS_DESC: Record<string, string> = {
    confirmed: 'We have received your order and it is confirmed.',
    preparing: 'Our team is preparing your beautiful flowers.',
    out_for_delivery: 'Your order is on the way!',
    delivered: 'Your order has been delivered. Enjoy the flowers!',
    cancelled: 'This order has been cancelled.',
  };

  readonly TIMELINE = ['confirmed', 'preparing', 'out_for_delivery', 'delivered'];

  orderId = '';
  loading = signal(false);
  order = signal<any>(null);
  error = signal('');

  constructor(private http: HttpClient, private route: ActivatedRoute) {}

  ngOnInit(): void {
    const id = this.route.snapshot.queryParamMap.get('id');
    if (id) {
      this.orderId = id;
      this.track();
    }
  }

  track(): void {
    const id = this.orderId.trim().toUpperCase();
    if (!id) return;
    this.loading.set(true);
    this.order.set(null);
    this.error.set('');
    this.http.get<any>(`${environment.apiUrl}/api/orders/${id}`).subscribe({
      next: (data) => { this.order.set(data); this.loading.set(false); },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.status === 404 ? 'No order found with that ID. Please check and try again.' : 'Something went wrong. Please try again.');
      }
    });
  }

  statusIndex(status: string): number {
    return this.TIMELINE.indexOf(status);
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata'
    });
  }

  itemsSubtotal(o: any): number {
    return (o.items || []).reduce((sum: number, i: any) => sum + (i.price * i.quantity), 0);
  }

  shippingFee(o: any): number {
    if (o.shipping_fee != null) return o.shipping_fee;
    // fallback for old orders without stored shipping_fee
    return this.itemsSubtotal(o) >= 50 ? 0 : 9.99;
  }

  discountAmount(o: any): number {
    return o.discount_amount || 0;
  }

  discountLabel(o: any): string {
    if (o.promo_code) return `Promo (${o.promo_code})`;
    if (o.points_redeemed > 0) return `Loyalty points (${o.points_redeemed} pts)`;
    return 'Discount';
  }
}
