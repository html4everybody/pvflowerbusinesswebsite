import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';

type Tab = 'profile' | 'orders';

@Component({
  selector: 'app-account',
  imports: [RouterLink, FormsModule],
  templateUrl: './account.html',
  styleUrl: './account.scss'
})
export class Account {
  activeTab = signal<Tab>('profile');

  profileForm = { firstName: '', lastName: '' };
  profileSaving  = signal(false);
  profileSuccess = signal('');
  profileError   = signal('');

  pwForm = { current: '', newPw: '', confirm: '' };
  showCurrentPw = signal(false);
  showNewPw     = signal(false);
  showConfirmPw = signal(false);
  pwSaving      = signal(false);
  pwSuccess     = signal('');
  pwError       = signal('');

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

  get userInitials(): string {
    const user = this.authService.user();
    if (!user) return '';
    return ((user.firstName?.[0] ?? '') + (user.lastName?.[0] ?? '')).toUpperCase();
  }

  constructor(public authService: AuthService, private http: HttpClient) {
    const user = this.authService.user();
    if (user) {
      this.profileForm.firstName = user.firstName;
      this.profileForm.lastName  = user.lastName;
    }
  }

  saveProfile() {
    if (!this.profileForm.firstName.trim()) return;
    this.profileSaving.set(true);
    this.profileSuccess.set('');
    this.profileError.set('');
    const token = localStorage.getItem('viva_token');
    this.http.put(`${environment.apiUrl}/api/auth/profile`, {
      token,
      first_name: this.profileForm.firstName,
      last_name:  this.profileForm.lastName
    }).subscribe({
      next: (res: any) => {
        this.profileSaving.set(false);
        this.profileSuccess.set('Profile updated successfully.');
        const user = this.authService.user();
        if (user) {
          const updated = { ...user, firstName: res.firstName, lastName: res.lastName };
          localStorage.setItem('viva_user', JSON.stringify(updated));
          this.authService.user.set(updated);
        }
      },
      error: (err) => {
        this.profileSaving.set(false);
        this.profileError.set(err.error?.detail || 'Failed to update profile.');
      }
    });
  }

  changePassword() {
    if (!this.pwValid) return;
    if (this.pwForm.newPw !== this.pwForm.confirm) {
      this.pwError.set('Passwords do not match.');
      return;
    }
    this.pwSaving.set(true);
    this.pwSuccess.set('');
    this.pwError.set('');
    const token = localStorage.getItem('viva_token');
    this.http.put(`${environment.apiUrl}/api/auth/change-password`, {
      token,
      current_password: this.pwForm.current,
      new_password: this.pwForm.newPw
    }).subscribe({
      next: () => {
        this.pwSaving.set(false);
        this.pwSuccess.set('Password changed successfully.');
        this.pwForm = { current: '', newPw: '', confirm: '' };
      },
      error: (err) => {
        this.pwSaving.set(false);
        this.pwError.set(err.error?.detail || 'Failed to change password.');
      }
    });
  }
}
