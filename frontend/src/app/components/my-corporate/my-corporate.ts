import { Component, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth';
import { CorporateService, CorporateOrder } from '../../services/corporate';
import { ToastService } from '../../services/toast';

@Component({
  selector: 'app-my-corporate',
  imports: [RouterLink],
  templateUrl: './my-corporate.html',
  styleUrl: './my-corporate.scss'
})
export class MyCorporate implements OnInit {
  loading = signal(true);
  orders = signal<CorporateOrder[]>([]);
  actionId = signal('');
  confirmCancelId = signal('');

  constructor(
    private authService: AuthService,
    private corporateService: CorporateService,
    private toastService: ToastService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    const user = this.authService.user();
    if (!user) {
      this.router.navigate(['/signin']);
      return;
    }
    this.load(user.email);
  }

  private load(email: string): void {
    this.loading.set(true);
    this.corporateService.getAll(email).subscribe({
      next: (data) => {
        this.orders.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  get activeOrders(): CorporateOrder[] {
    return this.orders().filter(o => o.status !== 'cancelled');
  }

  get cancelledOrders(): CorporateOrder[] {
    return this.orders().filter(o => o.status === 'cancelled');
  }

  confirmCancel(id: string): void {
    this.confirmCancelId.set(id);
  }

  closeDialog(): void {
    this.confirmCancelId.set('');
  }

  doCancel(): void {
    const id = this.confirmCancelId();
    if (!id) return;
    this.actionId.set(id + '-cancel');
    this.corporateService.cancel(id).subscribe({
      next: () => {
        this.orders.update(list => list.map(o => o.id === id ? { ...o, status: 'cancelled' } : o));
        this.actionId.set('');
        this.confirmCancelId.set('');
        this.toastService.show('Order cancelled.');
      },
      error: () => {
        this.actionId.set('');
        this.confirmCancelId.set('');
        this.toastService.show('Failed to cancel order.', 'error');
      }
    });
  }

  skip(order: CorporateOrder): void {
    this.actionId.set(order.id + '-skip');
    this.corporateService.skip(order.id).subscribe({
      next: (res) => {
        this.orders.update(list => list.map(o => o.id === order.id ? { ...o, next_delivery: res.next_delivery } : o));
        this.actionId.set('');
        this.toastService.show('Next delivery skipped!');
      },
      error: () => {
        this.actionId.set('');
        this.toastService.show('Failed to skip delivery.', 'error');
      }
    });
  }

  isLoading(id: string): boolean {
    return this.actionId().startsWith(id);
  }

  formatDate(dateStr: string | undefined): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  capitalize(s: string): string {
    return s ? s[0].toUpperCase() + s.slice(1) : '';
  }
}
