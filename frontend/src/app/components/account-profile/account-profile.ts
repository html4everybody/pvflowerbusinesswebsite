import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-account-profile',
  imports: [FormsModule, RouterLink],
  templateUrl: './account-profile.html',
  styleUrl: './account-profile.scss'
})
export class AccountProfile {
  profileForm = { firstName: '', lastName: '' };
  saving  = signal(false);
  success = signal('');
  error   = signal('');

  constructor(public authService: AuthService, private http: HttpClient) {
    const user = authService.user();
    if (user) {
      this.profileForm.firstName = user.firstName;
      this.profileForm.lastName  = user.lastName;
    }
  }

  save() {
    if (!this.profileForm.firstName.trim()) return;
    this.saving.set(true);
    this.success.set('');
    this.error.set('');
    const token = this.authService.getToken();
    this.http.put(`${environment.apiUrl}/api/auth/profile`, {
      token,
      first_name: this.profileForm.firstName,
      last_name:  this.profileForm.lastName
    }).subscribe({
      next: (res: any) => {
        this.saving.set(false);
        this.success.set('Profile updated successfully.');
        const user = this.authService.user();
        if (user) {
          const updated = { ...user, firstName: res.firstName, lastName: res.lastName };
          this.authService.updateStoredUser(updated);
        }
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(err.error?.detail || 'Failed to update profile.');
      }
    });
  }
}
