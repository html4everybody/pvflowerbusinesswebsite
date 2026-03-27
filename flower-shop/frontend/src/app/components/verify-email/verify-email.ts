import { Component, signal, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-verify-email',
  imports: [RouterLink],
  templateUrl: './verify-email.html',
  styleUrl: './verify-email.scss'
})
export class VerifyEmail implements OnInit {
  status = signal<'loading' | 'success' | 'error' | 'resent'>('loading');
  errorMessage = signal('');
  resendEmail = signal('');
  resendLoading = signal(false);

  constructor(private route: ActivatedRoute, private http: HttpClient) {}

  ngOnInit(): void {
    const token = this.route.snapshot.queryParams['token'];
    if (!token) {
      this.status.set('error');
      this.errorMessage.set('No verification token found.');
      return;
    }
    this.http.get<{ message: string }>(`${environment.apiUrl}/api/auth/verify-email?token=${token}`).subscribe({
      next: () => this.status.set('success'),
      error: (err) => {
        this.status.set('error');
        this.errorMessage.set(err.error?.detail || 'Verification failed. The link may have expired.');
      }
    });
  }

  resend(): void {
    const email = this.resendEmail().trim();
    if (!email) return;
    this.resendLoading.set(true);
    this.http.post(`${environment.apiUrl}/api/auth/resend-verification`, { email }).subscribe({
      next: () => {
        this.resendLoading.set(false);
        this.status.set('resent');
      },
      error: () => {
        this.resendLoading.set(false);
        this.status.set('resent'); // show resent even on error to avoid email enumeration
      }
    });
  }
}
