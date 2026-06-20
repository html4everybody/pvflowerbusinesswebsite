import { Component, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-forgot-password',
  imports: [RouterLink],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.scss'
})
export class ForgotPassword {
  email   = signal('');
  loading = signal(false);
  sent    = signal(false);
  error   = signal('');

  constructor(private http: HttpClient) {}

  send() {
    const emailVal = this.email().trim();
    if (!emailVal) return;
    this.loading.set(true);
    this.error.set('');
    this.http.post(`${environment.apiUrl}/api/auth/forgot-password`, { email: emailVal }).subscribe({
      next: () => { this.loading.set(false); this.sent.set(true); },
      error: (err) => {
        this.loading.set(false);
        const detail = err.error?.detail;
        this.error.set(typeof detail === 'string' ? detail : 'Something went wrong. Please try again.');
      }
    });
  }

  onEmailInput(event: Event) {
    this.email.set((event.target as HTMLInputElement).value);
  }
}
