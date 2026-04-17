import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private apiUrl = environment.apiUrl;

  user = signal<any>(this.loadUser());

  constructor(private http: HttpClient) {}

  private loadUser(): any {
    try {
      const stored = localStorage.getItem('viva_user');
      return stored && stored !== 'undefined' ? JSON.parse(stored) : null;
    } catch {
      localStorage.removeItem('viva_user');
      return null;
    }
  }

  login(email: string, password: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/api/auth/login`, { email, password }).pipe(
      tap(res => {
        localStorage.setItem('viva_token', res.token);
        localStorage.setItem('viva_user', JSON.stringify(res.user));
        this.user.set(res.user);
      })
    );
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
    localStorage.removeItem('viva_token');
    localStorage.removeItem('viva_user');
    this.user.set(null);
  }

  isLoggedIn(): boolean {
    return !!localStorage.getItem('viva_token');
  }

  isAdmin(): boolean {
    return !!this.user()?.is_admin;
  }

  getToken(): string {
    return localStorage.getItem('viva_token') || '';
  }
}
