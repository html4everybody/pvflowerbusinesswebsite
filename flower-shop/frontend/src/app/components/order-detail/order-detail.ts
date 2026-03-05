import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth';
import { ToastService } from '../../services/toast';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-order-detail',
  imports: [RouterLink],
  templateUrl: './order-detail.html',
  styleUrl: './order-detail.scss'
})
export class OrderDetail implements OnInit {
  readonly STATUS_ORDER = ['confirmed', 'preparing', 'out_for_delivery', 'delivered'] as const;
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
  readonly STATUS_DESCRIPTIONS: Record<string, string> = {
    confirmed: 'Your order has been received and confirmed.',
    preparing: 'Our team is carefully preparing your flowers.',
    out_for_delivery: 'Your order is on its way to you!',
    delivered: 'Your order has been delivered. Enjoy!'
  };

  readonly timeSlots = [
    { key: '09:00', label: '9:00 AM – 11:00 AM' },
    { key: '11:00', label: '11:00 AM – 1:00 PM' },
    { key: '13:00', label: '1:00 PM – 3:00 PM' },
    { key: '15:00', label: '3:00 PM – 5:00 PM' },
    { key: '17:00', label: '5:00 PM – 7:00 PM' },
  ];
  private readonly timeSlotsMap = Object.fromEntries(this.timeSlots.map(s => [s.key, s.label]));

  order = signal<any | null>(null);
  loading = signal(true);
  notFound = signal(false);
  updatingStatus = signal(false);

  cancelling = signal(false);
  cancelError = signal('');

  editingDelivery = signal(false);
  editDelivery = signal<{ type: 'immediate' | 'scheduled'; date: string; time: string }>({ type: 'immediate', date: '', time: '' });
  savingDelivery = signal(false);
  deliverySaveError = signal('');

  minDate = new Date().toISOString().split('T')[0];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private authService: AuthService,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    if (!this.authService.isLoggedIn()) {
      this.router.navigate(['/signin']);
      return;
    }
    const id = this.route.snapshot.paramMap.get('id');
    this.http.get<any>(`${environment.apiUrl}/api/orders/${id}`).subscribe({
      next: (data) => { this.order.set(data); this.loading.set(false); },
      error: () => { this.loading.set(false); this.notFound.set(true); }
    });
  }

  statusIndex(status: string): number {
    return this.STATUS_ORDER.indexOf(status as any);
  }

  cancelOrder(): void {
    const o = this.order();
    if (!o) return;
    this.cancelError.set('');
    if (o.status === 'out_for_delivery') {
      this.cancelError.set('Cannot cancel — order is already out for delivery.');
      return;
    }
    if (o.status === 'delivered') {
      this.cancelError.set('Cannot cancel — order has already been delivered.');
      return;
    }
    this.cancelling.set(true);
    this.http.patch(`${environment.apiUrl}/api/orders/${o.id}/cancel`, {}).subscribe({
      next: () => {
        this.order.update(prev => ({ ...prev, status: 'cancelled' }));
        this.cancelling.set(false);
        this.toastService.show('Your order has been cancelled.');
      },
      error: () => {
        this.cancelling.set(false);
        this.cancelError.set('Something went wrong. Please try again.');
      }
    });
  }

  startEditDelivery(): void {
    const o = this.order();
    if (!o) return;
    let type: 'immediate' | 'scheduled' = 'immediate';
    let date = '', time = '';
    if (o.delivery_type === 'scheduled' && o.delivery_datetime) {
      type = 'scheduled';
      const [d, t] = o.delivery_datetime.split('T');
      date = d || '';
      time = t?.substring(0, 5) || '';
    }
    this.editDelivery.set({ type, date, time });
    this.deliverySaveError.set('');
    this.editingDelivery.set(true);
  }

  cancelEditDelivery(): void {
    this.editingDelivery.set(false);
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

  saveDelivery(): void {
    const edit = this.editDelivery();
    const o = this.order();
    if (!o) return;
    if (edit.type === 'scheduled' && (!edit.date || !edit.time)) {
      this.deliverySaveError.set('Please select both a date and time slot.');
      return;
    }
    const deliveryDatetime = edit.type === 'scheduled' ? `${edit.date}T${edit.time}` : null;
    this.savingDelivery.set(true);
    this.deliverySaveError.set('');
    this.http.patch(`${environment.apiUrl}/api/orders/${o.id}/delivery`, {
      delivery_type: edit.type,
      delivery_datetime: deliveryDatetime
    }).subscribe({
      next: () => {
        this.order.update(prev => ({ ...prev, delivery_type: edit.type, delivery_datetime: deliveryDatetime }));
        this.savingDelivery.set(false);
        this.editingDelivery.set(false);
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
      year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  formatRecurrenceDate(dateStr: string): string {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US',
      { month: 'long', day: 'numeric', year: 'numeric' });
  }

  get isAdmin(): boolean { return this.authService.isAdmin(); }

  adminUpdateStatus(order: any, newStatus: string): void {
    this.updatingStatus.set(true);
    this.http.patch<{ status: string }>(`${environment.apiUrl}/api/orders/${order.id}/status`, { status: newStatus }).subscribe({
      next: (res) => {
        this.order.update(prev => ({ ...prev, status: res.status }));
        this.updatingStatus.set(false);
        this.toastService.show(`Status updated to ${this.STATUS_LABELS[res.status]}`);
      },
      error: () => {
        this.updatingStatus.set(false);
        this.toastService.show('Could not update status.');
      }
    });
  }

  formatDelivery(o: any): { label: string; detail: string } {
    if (!o.delivery_type || o.delivery_type === 'immediate') {
      return { label: 'Immediate Delivery', detail: 'As soon as possible' };
    }
    if (o.delivery_datetime) {
      const [datePart, timePart] = o.delivery_datetime.split('T');
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
