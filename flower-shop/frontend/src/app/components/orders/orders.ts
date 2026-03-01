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
  readonly STATUS_ORDER = ['confirmed', 'preparing', 'out_for_delivery', 'delivered'] as const;
  readonly STATUS_LABELS: Record<string, string> = {
    confirmed: 'Confirmed', preparing: 'Preparing',
    out_for_delivery: 'Out for Delivery', delivered: 'Delivered', cancelled: 'Cancelled'
  };

  orders = signal<any[]>([]);
  loading = signal(true);
  cancellingId = signal<string | null>(null);
  cancelErrors = signal<Record<string, string>>({});
  activeTab = signal<'active' | 'cancelled'>('active');
  advancingId = signal<string | null>(null);

  // Delivery edit state
  editingDeliveryId = signal<string | null>(null);
  editDelivery = signal<{ type: 'immediate' | 'scheduled'; date: string; time: string }>({ type: 'immediate', date: '', time: '' });
  savingDelivery = signal(false);
  deliverySaveError = signal('');

  minDate = new Date().toISOString().split('T')[0];

  readonly timeSlots = [
    { key: '09:00', label: '9:00 AM – 11:00 AM' },
    { key: '11:00', label: '11:00 AM – 1:00 PM' },
    { key: '13:00', label: '1:00 PM – 3:00 PM' },
    { key: '15:00', label: '3:00 PM – 5:00 PM' },
    { key: '17:00', label: '5:00 PM – 7:00 PM' },
  ];

  private readonly timeSlotsMap: Record<string, string> = Object.fromEntries(
    this.timeSlots.map(s => [s.key, s.label])
  );

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

  statusIndex(status: string): number {
    return this.STATUS_ORDER.indexOf(status as any);
  }

  cancelOrder(order: any): void {
    this.cancelErrors.update(errs => ({ ...errs, [order.id]: '' }));

    if (order.status === 'out_for_delivery') {
      this.cancelErrors.update(errs => ({ ...errs, [order.id]: 'You cannot cancel this order as it is already out for delivery.' }));
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

  advanceStatus(order: any): void {
    const idx = this.statusIndex(order.status);
    if (idx < 0 || idx >= this.STATUS_ORDER.length - 1) return;
    const nextStatus = this.STATUS_ORDER[idx + 1];
    this.advancingId.set(order.id);
    this.http.patch<{ status: string }>(`${environment.apiUrl}/api/orders/${order.id}/status`, { status: nextStatus }).subscribe({
      next: (res) => {
        this.orders.update(list =>
          list.map(o => o.id === order.id ? { ...o, status: res.status } : o)
        );
        this.advancingId.set(null);
        this.toastService.show(`Order status updated to: ${this.STATUS_LABELS[res.status]}`);
      },
      error: () => {
        this.advancingId.set(null);
        this.toastService.show('Could not update status. Please try again.');
      }
    });
  }

  startEditDelivery(order: any): void {
    if (this.editingDeliveryId() === order.id) {
      this.editingDeliveryId.set(null);
      return;
    }
    let type: 'immediate' | 'scheduled' = 'immediate';
    let date = '';
    let time = '';
    if (order.delivery_type === 'scheduled' && order.delivery_datetime) {
      type = 'scheduled';
      const [datePart, timePart] = order.delivery_datetime.split('T');
      date = datePart || '';
      time = timePart?.substring(0, 5) || '';
    }
    this.editDelivery.set({ type, date, time });
    this.deliverySaveError.set('');
    this.editingDeliveryId.set(order.id);
  }

  cancelEditDelivery(): void {
    this.editingDeliveryId.set(null);
    this.deliverySaveError.set('');
  }

  setEditType(type: 'immediate' | 'scheduled'): void {
    this.editDelivery.update(d => ({ ...d, type }));
  }

  setEditDate(date: string): void {
    this.editDelivery.update(d => ({ ...d, date }));
  }

  setEditTime(time: string): void {
    this.editDelivery.update(d => ({ ...d, time }));
  }

  saveDelivery(order: any): void {
    const edit = this.editDelivery();
    if (edit.type === 'scheduled' && (!edit.date || !edit.time)) {
      this.deliverySaveError.set('Please select both a date and time slot.');
      return;
    }
    const deliveryDatetime = edit.type === 'scheduled' ? `${edit.date}T${edit.time}` : null;
    this.savingDelivery.set(true);
    this.deliverySaveError.set('');
    this.http.patch(`${environment.apiUrl}/api/orders/${order.id}/delivery`, {
      delivery_type: edit.type,
      delivery_datetime: deliveryDatetime
    }).subscribe({
      next: () => {
        this.orders.update(list =>
          list.map(o => o.id === order.id ? { ...o, delivery_type: edit.type, delivery_datetime: deliveryDatetime } : o)
        );
        this.savingDelivery.set(false);
        this.editingDeliveryId.set(null);
        this.toastService.show('Delivery schedule updated.');
      },
      error: () => {
        this.savingDelivery.set(false);
        this.deliverySaveError.set('Could not update. Please try again.');
      }
    });
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  formatRecurrenceDate(dateStr: string): string {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US',
      { month: 'long', day: 'numeric', year: 'numeric' });
  }

  formatDelivery(order: any): { label: string; detail: string } {
    if (!order.delivery_type || order.delivery_type === 'immediate') {
      return { label: 'Immediate Delivery', detail: 'As soon as possible' };
    }
    if (order.delivery_datetime) {
      const [datePart, timePart] = order.delivery_datetime.split('T');
      const dateStr = new Date(datePart + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
      });
      const timeKey = timePart?.substring(0, 5);
      const timeLabel = this.timeSlotsMap[timeKey] || timeKey;
      return { label: 'Scheduled Delivery', detail: `${dateStr}, ${timeLabel}` };
    }
    return { label: 'Scheduled Delivery', detail: 'Date not specified' };
  }
}
