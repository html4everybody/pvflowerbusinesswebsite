import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private apiUrl = environment.apiUrl;

  user = signal<any>(this.loadUser());

  constructor(private http: HttpClient, private router: Router) {
    this.validateSession();
    // Re-check every 10 seconds so other-device email changes sign out this session immediately
    setInterval(() => this.validateSession(), 10 * 1000);
  }

  private validateSession(): void {
    const token = this.getToken();
    if (!token) return;
    this.http.get<any>(`${this.apiUrl}/api/auth/me?token=${token}`).subscribe({
      error: (err) => {
        if (err.status === 401) {
          this.clearSession();
          this.router.navigate(['/signin']);
        }
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
    return this.http.post<any>(`${this.apiUrl}/api/auth/register`, data).pipe(
      tap(res => {
        localStorage.setItem('viva_token', res.token);
        localStorage.setItem('viva_user', JSON.stringify(res.user));
        this.user.set(res.user);
      })
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

  getToken(): string {
    return localStorage.getItem('viva_token') || sessionStorage.getItem('viva_token') || '';
  }
}
