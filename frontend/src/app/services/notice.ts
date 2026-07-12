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
  }

  load(): void {
    const email = this.auth.user()?.email;
    if (!email) return;
    this.http.get<UserNotice[]>(`${environment.apiUrl}/api/notices?email=${encodeURIComponent(email)}`).subscribe({
      next: d => this.notices.set(d || []),
      error: () => {},
    });
  }

  markAllRead(): void {
    const email = this.auth.user()?.email;
    if (!email || this.unread() === 0) return;
    this.notices.update(l => l.map(n => ({ ...n, read: true })));
    this.http.patch(`${environment.apiUrl}/api/notices/read?email=${encodeURIComponent(email)}`, {}).subscribe({ error: () => {} });
  }

  dismiss(id: string): void {
    const email = this.auth.user()?.email;
    if (!email) return;
    this.notices.update(l => l.filter(n => n.id !== id));
    this.http.delete(`${environment.apiUrl}/api/notices/${id}?email=${encodeURIComponent(email)}`).subscribe({ error: () => {} });
  }

  noticeRoute(n: UserNotice): string[] | null {
    if (!n.ref_type) return null;
    if (n.ref_type === 'order' && n.ref_id) return ['/orders', n.ref_id];
    if (n.ref_type === 'subscription') return ['/my-subscriptions'];
    if (n.ref_type === 'booking') return ['/my-studio'];
    return null;
  }
}
