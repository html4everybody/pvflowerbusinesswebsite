import { Component, OnInit, signal, computed, effect } from '@angular/core';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth';
import { NoticeService } from '../../services/notice';
import { AccountNav } from '../account-nav/account-nav';
import { environment } from '../../../environments/environment';

type Tab = 'profile' | 'orders' | 'notifications';

@Component({
  selector: 'app-account',
  imports: [RouterLink, FormsModule, AccountNav],
  templateUrl: './account.html',
  styleUrl: './account.scss'
})
export class Account implements OnInit {
  activeTab: ReturnType<typeof signal<Tab>>;

  profileForm = { firstName: '', lastName: '' };
  profileSaving  = signal(false);
  profileSuccess = signal('');
  profileError   = signal('');

  // ── Password ─────────────────────────────────────────────────────────────
  pwForm = { current: '', newPw: '', confirm: '' };
  showCurrentPw = signal(false);
  showNewPw     = signal(false);
  showConfirmPw = signal(false);
  pwSaving      = signal(false);
  pwSuccess     = signal('');
  pwError       = signal('');

  // ── Orders ───────────────────────────────────────────────────────────────
  readonly STATUS_LABELS: Record<string, string> = {
    confirmed: 'Confirmed', preparing: 'Preparing',
    out_for_delivery: 'Out for Delivery', delivered: 'Delivered', cancelled: 'Cancelled'
  };

  orders        = signal<any[]>([]);
  ordersLoading = signal(false);
  orderSearch   = signal('');
  orderStatus   = signal('all');

  visibleOrders = computed(() => {
    let list = this.orders();
    const q = this.orderSearch().trim().toLowerCase();
    if (q) list = list.filter(o => o.id.toLowerCase().includes(q));
    if (this.orderStatus() !== 'all') list = list.filter(o => o.status === this.orderStatus());
    return list;
  });

  get checks() {
    const p = this.pwForm.newPw;
    return {
      length:  p.length >= 8,
      upper:   /[A-Z]/.test(p),
      lower:   /[a-z]/.test(p),
      number:  /[0-9]/.test(p),
      special: /[^A-Za-z0-9]/.test(p)
    };
  }

  get pwValid() {
    const c = this.checks;
    return c.length && c.upper && c.lower && c.number && c.special;
  }

  get userInitials(): string {
    const user = this.authService.user();
    if (!user) return '';
    return ((user.firstName?.[0] ?? '') + (user.lastName?.[0] ?? '')).toUpperCase();
  }

  constructor(public authService: AuthService, private http: HttpClient, private router: Router, private route: ActivatedRoute, public noticeService: NoticeService) {
    const isBackNav = this.router.getCurrentNavigation()?.trigger === 'popstate';
    const savedTab = sessionStorage.getItem('account_tab') as Tab;
    this.activeTab = signal<Tab>(isBackNav && savedTab ? savedTab : 'profile');
    effect(() => sessionStorage.setItem('account_tab', this.activeTab()));
    // Mark notices read when the user opens the Notifications tab (re-runs once they load).
    effect(() => {
      this.noticeService.notices();
      if (this.activeTab() === 'notifications') this.noticeService.markAllRead();
    });
    const user = this.authService.user();
    if (user) {
      this.profileForm.firstName = user.firstName;
      this.profileForm.lastName  = user.lastName;
    }
  }

  ngOnInit(): void {
    this.noticeService.load();
    // Sidebar links drive the active tab via ?tab=; keep the URL in sync.
    this.route.queryParams.subscribe(p => {
      const t = p['tab'] as Tab;
      if (t === 'profile' || t === 'orders' || t === 'notifications') this.activeTab.set(t);
    });
    if (!this.route.snapshot.queryParams['tab']) {
      this.router.navigate([], { relativeTo: this.route, queryParams: { tab: this.activeTab() }, replaceUrl: true });
    }

    const user = this.authService.user();
    if (!user) return;
    this.ordersLoading.set(true);
    const token = this.authService.getToken();
    const params = `email=${encodeURIComponent(user.email)}${token ? `&token=${token}` : ''}`;
    this.http.get<any[]>(`${environment.apiUrl}/api/orders?${params}`).subscribe({
      next: (data) => { this.orders.set(data); this.ordersLoading.set(false); },
      error: () => this.ordersLoading.set(false)
    });
  }

  saveProfile() {
    if (!this.profileForm.firstName.trim()) return;
    this.profileSaving.set(true);
    this.profileSuccess.set('');
    this.profileError.set('');
    const token = this.authService.getToken();
    this.http.put(`${environment.apiUrl}/api/auth/profile`, {
      token,
      first_name: this.profileForm.firstName,
      last_name:  this.profileForm.lastName
    }).subscribe({
      next: (res: any) => {
        this.profileSaving.set(false);
        this.profileSuccess.set('Profile updated successfully.');
        const user = this.authService.user();
        if (user) {
          const updated = { ...user, firstName: res.firstName, lastName: res.lastName };
          this.authService.updateStoredUser(updated);
        }
      },
      error: (err) => {
        this.profileSaving.set(false);
        this.profileError.set(err.error?.detail || 'Failed to update profile.');
      }
    });
  }

  changePassword() {
    if (!this.pwValid) return;
    if (this.pwForm.newPw !== this.pwForm.confirm) {
      this.pwError.set('Passwords do not match.');
      return;
    }
    this.pwSaving.set(true);
    this.pwSuccess.set('');
    this.pwError.set('');
    const token = this.authService.getToken();
    this.http.put(`${environment.apiUrl}/api/auth/change-password`, {
      token,
      current_password: this.pwForm.current,
      new_password: this.pwForm.newPw
    }).subscribe({
      next: () => {
        this.pwSaving.set(false);
        this.pwSuccess.set('Password changed successfully.');
        this.pwForm = { current: '', newPw: '', confirm: '' };
      },
      error: (err) => {
        this.pwSaving.set(false);
        this.pwError.set(err.error?.detail || 'Failed to change password.');
      }
    });
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata'
    });
  }

  itemCount(order: any): number {
    return (order.items || []).reduce((sum: number, i: any) => sum + i.quantity, 0);
  }
}
