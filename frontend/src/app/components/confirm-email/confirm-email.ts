import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-confirm-email',
  imports: [RouterLink],
  templateUrl: './confirm-email.html',
  styleUrl: './confirm-email.scss'
})
export class ConfirmEmail implements OnInit {
  status = signal<'loading' | 'success' | 'error'>('loading');
  message = signal('');
  newEmail = signal('');

  constructor(private route: ActivatedRoute, private http: HttpClient, private authService: AuthService) {}

  ngOnInit() {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.status.set('error');
      this.message.set('Invalid confirmation link.');
      return;
    }
    this.http.get<any>(`${environment.apiUrl}/api/auth/confirm-email?token=${token}`).subscribe({
      next: (res) => {
        this.status.set('success');
        this.message.set(res.message);
        this.newEmail.set(res.email);
        // Sign out so they log in fresh with new email
        this.authService.logout();
      },
      error: (err) => {
        this.status.set('error');
        this.message.set(err.error?.detail || 'Failed to confirm email.');
      }
    });
  }
}
