import { Component, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-account-email',
  imports: [FormsModule],
  templateUrl: './account-email.html',
  styleUrl: './account-email.scss'
})
export class AccountEmail {
  newEmail      = '';
  currentPassword = '';
  showPassword  = signal(false);
  saving  = signal(false);
  success = signal('');
  error   = signal('');

  constructor(public authService: AuthService, private http: HttpClient, private location: Location) {}

  goBack() { this.location.back(); }

  save() {
    const email = this.newEmail.trim().toLowerCase();
    if (!email || !email.includes('@') || !this.currentPassword) return;
    if (email === this.authService.user()?.email) {
      this.error.set('New email is the same as your current email.');
      return;
    }
    this.saving.set(true);
    this.success.set('');
    this.error.set('');
    const token = localStorage.getItem('viva_token');
    this.http.put<any>(`${environment.apiUrl}/api/auth/update-email`, {
      token,
      new_email: email,
      current_password: this.currentPassword
    }).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.success.set(res.message);
        this.newEmail = '';
        this.currentPassword = '';
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(err.error?.detail || 'Failed to update email.');
      }
    });
  }
}
