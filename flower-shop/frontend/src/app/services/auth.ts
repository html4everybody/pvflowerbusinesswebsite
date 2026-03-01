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
    const stored = localStorage.getItem('floran_user');
    return stored ? JSON.parse(stored) : null;
  }

  login(email: string, password: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/api/auth/login`, { email, password }).pipe(
      tap(res => {
        localStorage.setItem('floran_token', res.token);
        localStorage.setItem('floran_user', JSON.stringify(res.user));
        this.user.set(res.user);
      })
    );
  }

  register(data: { firstName: string; lastName: string; email: string; password: string; referral_code?: string }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/api/auth/register`, data).pipe(
      tap(res => {
        localStorage.setItem('floran_token', res.token);
        localStorage.setItem('floran_user', JSON.stringify(res.user));
        this.user.set(res.user);
      })
    );
  }

  logout(): void {
    localStorage.removeItem('floran_token');
    localStorage.removeItem('floran_user');
    this.user.set(null);
  }

  isLoggedIn(): boolean {
    return !!localStorage.getItem('floran_token');
  }
}
