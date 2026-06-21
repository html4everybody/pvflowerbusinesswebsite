import { Component, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-account-password',
  imports: [FormsModule],
  templateUrl: './account-password.html',
  styleUrl: './account-password.scss'
})
export class AccountPassword {
  pwForm = { current: '', newPw: '', confirm: '' };
  showCurrent = signal(false);
  showNew     = signal(false);
  showConfirm = signal(false);
  saving  = signal(false);
  success = signal('');
  error   = signal('');

  get checks() {
    const p = this.pwForm.newPw;
    return {
      length:  p.length >= 8,
      upper:   /[A-Z]/.test(p),
      lower:   /[a-z]/.test(p),
      number:  /[0-9]/.test(p),
      special: /[^A-Za-z0-9]/.test(p)
    };
  }

  get pwValid() {
    const c = this.checks;
    return c.length && c.upper && c.lower && c.number && c.special;
  }

  noPassword  = signal(false);
  resetSending = signal(false);
  resetSent    = signal(false);

  constructor(public authService: AuthService, private readonly http: HttpClient, private location: Location) {}

  goBack() { this.location.back(); }

  sendResetLink() {
    const email = this.authService.user()?.email;
    if (!email) return;
    this.resetSending.set(true);
    this.http.post(`${environment.apiUrl}/api/auth/forgot-password`, { email }).subscribe({
      next: () => { this.resetSending.set(false); this.resetSent.set(true); },
      error: () => { this.resetSending.set(false); this.resetSent.set(true); }
    });
  }

  save() {
    if (!this.pwValid || this.pwForm.newPw !== this.pwForm.confirm) return;
    this.saving.set(true);
    this.success.set('');
    this.error.set('');
    const token = localStorage.getItem('viva_token');
    this.http.put(`${environment.apiUrl}/api/auth/change-password`, {
      token,
      current_password: this.pwForm.current,
      new_password: this.pwForm.newPw
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.success.set('Password changed successfully.');
        this.pwForm = { current: '', newPw: '', confirm: '' };
      },
      error: (err) => {
        this.saving.set(false);
        const detail: string = err.error?.detail || '';
        if (detail.startsWith('no_password:')) {
          this.noPassword.set(true);
        } else {
          this.error.set(detail || 'Failed to change password.');
        }
      }
    });
  }
}
