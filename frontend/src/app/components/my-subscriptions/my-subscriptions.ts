import { Component, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth';
import { SubscriptionService, Subscription } from '../../services/subscription';
import { ToastService } from '../../services/toast';

@Component({
  selector: 'app-my-subscriptions',
  imports: [RouterLink],
  templateUrl: './my-subscriptions.html',
  styleUrl: './my-subscriptions.scss'
})
export class MySubscriptions implements OnInit {
  subscriptions = signal<Subscription[]>([]);
  loading = signal(true);
  actionId = signal<string | null>(null);
  confirmCancelId = signal<string | null>(null);

  constructor(
    private authService: AuthService,
    private subscriptionService: SubscriptionService,
    private toastService: ToastService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    if (!this.authService.isLoggedIn()) {
      this.router.navigate(['/signin']);
      return;
    }
    const user = this.authService.user();
    this.subscriptionService.getAll(user.email).subscribe({
      next: (data) => { this.subscriptions.set(data); this.loading.set(false); },
      error: () => { this.loading.set(false); }
    });
  }

  get activeList(): Subscription[] { return this.subscriptions().filter(s => s.status === 'active'); }
  get pausedList(): Subscription[] { return this.subscriptions().filter(s => s.status === 'paused'); }
  get cancelledList(): Subscription[] { return this.subscriptions().filter(s => s.status === 'cancelled'); }

  pause(sub: Subscription): void {
    this.actionId.set(sub.id);
    this.subscriptionService.pause(sub.id).subscribe({
      next: () => {
        this.subscriptions.update(list => list.map(s => s.id === sub.id ? { ...s, status: 'paused' as const } : s));
        this.actionId.set(null);
        this.toastService.show('Subscription paused.');
      },
      error: () => { this.actionId.set(null); }
    });
  }

  resume(sub: Subscription): void {
    this.actionId.set(sub.id);
    this.subscriptionService.resume(sub.id).subscribe({
      next: () => {
        this.subscriptions.update(list => list.map(s => s.id === sub.id ? { ...s, status: 'active' as const } : s));
        this.actionId.set(null);
        this.toastService.show('Subscription resumed!');
      },
      error: () => { this.actionId.set(null); }
    });
  }

  skip(sub: Subscription): void {
    this.actionId.set(sub.id + '-skip');
    this.subscriptionService.skip(sub.id).subscribe({
      next: (res) => {
        this.subscriptions.update(list => list.map(s =>
          s.id === sub.id ? { ...s, next_delivery: res.next_delivery, skipped_count: s.skipped_count + 1 } : s
        ));
        this.actionId.set(null);
        this.toastService.show('Next delivery skipped.');
      },
      error: () => { this.actionId.set(null); }
    });
  }

  confirmCancel(sub: Subscription): void {
    this.confirmCancelId.set(sub.id);
  }

  cancelConfirmed(sub: Subscription): void {
    this.confirmCancelId.set(null);
    this.actionId.set(sub.id + '-cancel');
    this.subscriptionService.cancel(sub.id).subscribe({
      next: () => {
        this.subscriptions.update(list => list.map(s => s.id === sub.id ? { ...s, status: 'cancelled' as const } : s));
        this.actionId.set(null);
        this.toastService.show('Subscription cancelled.');
      },
      error: () => { this.actionId.set(null); }
    });
  }

  dismissCancel(): void { this.confirmCancelId.set(null); }

  isLoading(id: string): boolean { return this.actionId() === id || this.actionId() === id + '-skip' || this.actionId() === id + '-cancel'; }

  formatDate(dateStr: string): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  planLabel(plan: string): string {
    const map: Record<string, string> = { weekly: 'Weekly', biweekly: 'Bi-Weekly', monthly: 'Monthly' };
    return map[plan] ?? plan;
  }

  styleLabel(sub: Subscription): string {
    if (sub.style === 'fixed' && sub.fixed_product_name) return `Fixed: ${sub.fixed_product_name}`;
    return 'Seasonal Surprise';
  }

  planFreq(plan: string): string {
    const map: Record<string, string> = { weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Once a month' };
    return map[plan] ?? '';
  }
}
