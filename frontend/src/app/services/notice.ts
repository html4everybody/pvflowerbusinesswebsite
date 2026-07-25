import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth';
import { environment } from '../../environments/environment';

export interface UserNotice {
  id: string;
  title: string;
  message: string;
  ref_type?: string;
  ref_id?: string;
  read: boolean;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class NoticeService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  readonly notices = signal<UserNotice[]>([]);
  readonly unread = computed(() => this.notices().filter(n => !n.read).length);

  constructor() {
    effect(() => {
      if (this.auth.user()?.email) this.load();
      else this.notices.set([]);
    });

    // The effect above only re-fires when the cached user object actually
    // changes (AuthService dedupes its 10s session poll to avoid signal
    // churn), so a notice created while someone just sits on a page — a
    // merchant waiting for an order, a customer waiting on a status update —
    // previously never appeared until something else forced a reload. Poll
    // independently so the bell/badge stay live.
    setInterval(() => {
      if (this.auth.user()?.email) this.load();
    }, 25 * 1000);
  }

  load(): void {
    const email = this.auth.user()?.email;
    const token = this.auth.getToken();
    if (!email || !token) return;
    this.http.get<UserNotice[]>(`${environment.apiUrl}/api/notices?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`).subscribe({
      next: d => this.notices.set(d || []),
      error: () => {},
    });
  }

  markAllRead(): void {
    const email = this.auth.user()?.email;
    const token = this.auth.getToken();
    if (!email || !token || this.unread() === 0) return;
    this.notices.update(l => l.map(n => ({ ...n, read: true })));
    this.http.patch(`${environment.apiUrl}/api/notices/read?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`, {}).subscribe({ error: () => {} });
  }

  markOneRead(id: string): void {
    const email = this.auth.user()?.email;
    const token = this.auth.getToken();
    if (!email || !token) return;
    this.notices.update(l => l.map(n => n.id === id ? { ...n, read: true } : n));
    this.http.patch(`${environment.apiUrl}/api/notices/${id}/read?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`, {}).subscribe({ error: () => {} });
  }

  dismiss(id: string): void {
    const email = this.auth.user()?.email;
    const token = this.auth.getToken();
    if (!email || !token) return;
    this.notices.update(l => l.filter(n => n.id !== id));
    this.http.delete(`${environment.apiUrl}/api/notices/${id}?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`).subscribe({ error: () => {} });
  }

  noticeRoute(n: UserNotice): string[] | null {
    if (!n.ref_type) return null;
    switch (n.ref_type) {
      case 'order': return n.ref_id ? ['/orders', n.ref_id] : null;
      case 'subscription':
      case 'subscription_issue': return ['/my-subscriptions'];
      case 'booking': return ['/my-studio'];
      case 'cart_reminder': return ['/cart'];
      case 'winback':
      case 'reminder': return ['/products'];
      case 'loyalty': return ['/my-loyalty'];
      // Merchant-side events — the merchant dashboard has its own
      // sub-section state, not a route, so this just gets them into the
      // dashboard; the merchant's own notification panel there deep-links
      // into the right section.
      case 'merchant_product':
      case 'merchant_payout':
      case 'merchant_status':
      case 'merchant_order': return ['/merchant'];
      // Admin-only events
      case 'merchant_application':
      case 'corporate_multi_merchant':
      case 'contact': return ['/admin'];
      default: return null;
    }
  }
}
