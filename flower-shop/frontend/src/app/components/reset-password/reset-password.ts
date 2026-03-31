import { Component, signal, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-reset-password',
  imports: [RouterLink, FormsModule],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.scss'
})
export class ResetPassword implements OnInit {
  status = signal<'form' | 'loading' | 'success' | 'error'>('loading');
  errorMessage = signal('');
  token = '';
  newPassword = '';
  confirmPassword = '';
  submitting = signal(false);

  constructor(private route: ActivatedRoute, private http: HttpClient) {}

  ngOnInit(): void {
    const token = this.route.snapshot.queryParams['token'];
    if (!token) {
      this.status.set('error');
      this.errorMessage.set('No reset token found.');
      return;
    }
    this.token = token;
    this.status.set('form');
  }

  submit(): void {
    if (this.newPassword !== this.confirmPassword) {
      this.errorMessage.set('Passwords do not match.');
      return;
    }
    if (this.newPassword.length < 6) {
      this.errorMessage.set('Password must be at least 6 characters.');
      return;
    }
    this.errorMessage.set('');
    this.submitting.set(true);
    this.http.post(`${environment.apiUrl}/api/auth/reset-password`, {
      token: this.token,
      new_password: this.newPassword
    }).subscribe({
      next: () => { this.submitting.set(false); this.status.set('success'); },
      error: (err) => {
        this.submitting.set(false);
        this.errorMessage.set(err.error?.detail || 'Reset failed. The link may have expired.');
      }
    });
  }
}
