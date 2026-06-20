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
  status        = signal<'form' | 'loading' | 'success' | 'error'>('loading');
  errorMessage  = signal('');
  submitting    = signal(false);
  showNew       = signal(false);
  showConfirm   = signal(false);

  token           = '';
  newPassword     = '';
  confirmPassword = '';

  get checks() {
    const p = this.newPassword;
    return {
      length:  p.length >= 8,
      upper:   /[A-Z]/.test(p),
      lower:   /[a-z]/.test(p),
      number:  /[0-9]/.test(p),
      special: /[^A-Za-z0-9]/.test(p)
    };
  }

  get passwordValid() {
    const c = this.checks;
    return c.length && c.upper && c.lower && c.number && c.special;
  }

  constructor(private route: ActivatedRoute, private http: HttpClient) {}

  ngOnInit(): void {
    const token = this.route.snapshot.queryParams['token'];
    if (!token) {
      this.status.set('error');
      this.errorMessage.set('No reset token found. Please request a new link.');
      return;
    }
    this.token = token;
    this.status.set('form');
  }

  submit(): void {
    if (!this.passwordValid) {
      this.errorMessage.set('Password does not meet all requirements.');
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.errorMessage.set('Passwords do not match.');
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
        const detail = err.error?.detail;
        this.errorMessage.set(typeof detail === 'string' ? detail : 'Reset failed. The link may have expired.');
      }
    });
  }
}
