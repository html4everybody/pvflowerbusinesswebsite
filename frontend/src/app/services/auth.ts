import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private apiUrl = environment.apiUrl;

  user = signal<any>(this.loadUser());

  // Resolves once the *first* validateSession() round-trip has settled (or
  // immediately for a guest with no token). The cached `user()` on a fresh
  // load reflects whatever was last written to localStorage — including a
  // hand-tampered is_admin/merchant.status — so guards must await this
  // before trusting isAdmin()/isMerchant(), or a tampered value could render
  // the admin/merchant shell for one tick before the server-verified /me
  // response corrects it.
  private resolveSessionReady!: () => void;
  private sessionReadyPromise = new Promise<void>(resolve => { this.resolveSessionReady = resolve; });

  constructor(private http: HttpClient, private router: Router) {
    this.validateSession(true);
    // Re-check every 10 seconds so other-device email changes sign out this session immediately
    setInterval(() => this.validateSession(), 10 * 1000);
  }

  sessionReady(): Promise<void> {
    return this.sessionReadyPromise;
  }

  private readonly PROTECTED_PREFIXES = [
    '/account', '/orders', '/my-subscriptions',
    '/my-studio', '/my-loyalty', '/reminders', '/admin', '/petal-studio/book'
  ];

  private validateSession(isInitial: boolean = false): void {
    const token = this.getToken();
    if (!token) {
      if (isInitial) this.resolveSessionReady();
      return;
    }
    this.http.get<any>(`${this.apiUrl}/api/auth/me?token=${token}`).subscribe({
      next: (me) => {
        // Keep the cached user in sync (e.g. role/merchant approval) without
        // churning the signal every 10s — only write when something changed.
        if (me?.email) {
          const merged = { ...this.user(), ...me };
          if (JSON.stringify(this.user()) !== JSON.stringify(merged)) {
            this.updateStoredUser(merged);
          }
        }
        if (isInitial) this.resolveSessionReady();
      },
      error: (err) => {
        if (err.status === 401) {
          this.clearSession();
          // Only redirect to sign-in if the user is on a page that requires login.
          // On public pages (home, shop, etc.) just drop the expired token silently
          // so the user continues as a guest instead of being kicked to sign-in.
          const url = this.router.url.split('?')[0];
          if (this.PROTECTED_PREFIXES.some(p => url.startsWith(p))) {
            this.router.navigate(['/signin']);
          }
        }
        if (isInitial) this.resolveSessionReady();
      }
    });
  }

  private loadUser(): any {
    try {
      const stored = localStorage.getItem('viva_user') || sessionStorage.getItem('viva_user');
      return stored && stored !== 'undefined' ? JSON.parse(stored) : null;
    } catch {
      localStorage.removeItem('viva_user');
      sessionStorage.removeItem('viva_user');
      return null;
    }
  }

  login(email: string, password: string, remember: boolean = true): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/api/auth/login`, { email, password }).pipe(
      tap(res => this.setSession(res.token, res.user, remember))
    );
  }

  /**
   * Persist the session in localStorage (Remember me → survives browser
   * restarts) or sessionStorage (this browser session only, cleared on close).
   */
  setSession(token: string, user: any, remember: boolean): void {
    this.clearSession();
    const store = remember ? localStorage : sessionStorage;
    store.setItem('viva_token', token);
    store.setItem('viva_user', JSON.stringify(user));
    this.user.set(user);
  }

  private clearSession(): void {
    localStorage.removeItem('viva_token');
    localStorage.removeItem('viva_user');
    sessionStorage.removeItem('viva_token');
    sessionStorage.removeItem('viva_user');
    this.user.set(null);
  }

  /** Update the stored user (after profile/email changes) in whichever storage holds the session. */
  updateStoredUser(user: any): void {
    const store = localStorage.getItem('viva_token') ? localStorage : sessionStorage;
    store.setItem('viva_user', JSON.stringify(user));
    this.user.set(user);
  }

  register(data: { firstName: string; lastName: string; email: string; password: string; referral_code?: string }): Observable<any> {
    // Previously duplicated setSession()'s localStorage-write logic here
    // instead of calling it — always persistent regardless of what login()
    // would do for the same choice, and two copies of "write the session"
    // that could silently drift apart. Signup has no remember-me control of
    // its own, so this keeps the existing default (persistent) behavior.
    return this.http.post<any>(`${this.apiUrl}/api/auth/register`, data).pipe(
      tap(res => this.setSession(res.token, res.user, true))
    );
  }

  logout(): void {
    this.clearSession();
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  isAdmin(): boolean {
    return !!this.user()?.is_admin;
  }

  /** Current role: 'customer' | 'merchant' | 'admin'. */
  role(): string {
    return this.user()?.role || 'customer';
  }

  /** The signed-in user's shop, if any (null for non-merchants). */
  merchant(): any {
    return this.user()?.merchant || null;
  }

  /** True only for an APPROVED merchant (pending/suspended shops don't count). */
  isMerchant(): boolean {
    return this.user()?.merchant?.status === 'approved';
  }

  getToken(): string {
    return localStorage.getItem('viva_token') || sessionStorage.getItem('viva_token') || '';
  }
}
