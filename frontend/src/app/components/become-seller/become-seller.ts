import { Component, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth';
import { ToastService } from '../../services/toast';
import { environment } from '../../../environments/environment';

type ShopStatus = 'none' | 'pending' | 'approved' | 'suspended';

@Component({
  selector: 'app-become-seller',
  imports: [RouterLink, FormsModule],
  templateUrl: './become-seller.html',
  styleUrl: './become-seller.scss',
})
export class BecomeSeller implements OnInit {
  loading = signal(true);
  submitting = signal(false);
  status = signal<ShopStatus>('none');
  shopName = signal('');

  form = { shop_name: '', description: '', phone: '' };

  constructor(
    private http: HttpClient,
    private auth: AuthService,
    private toast: ToastService,
    private router: Router,
  ) {}

  private get token(): string { return this.auth.getToken(); }

  ngOnInit(): void {
    this.http.get<any>(`${environment.apiUrl}/api/merchant/me?token=${this.token}`).subscribe({
      next: (res) => {
        const m = res?.merchant;
        if (m) { this.status.set(m.status); this.shopName.set(m.shop_name); }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  submit(): void {
    if (!this.form.shop_name.trim()) { this.toast.show('Please enter a shop name', 'error'); return; }
    this.submitting.set(true);
    this.http.post<any>(`${environment.apiUrl}/api/merchant/apply`, { token: this.token, ...this.form }).subscribe({
      next: (res) => {
        this.submitting.set(false);
        this.status.set('pending');
        this.shopName.set(this.form.shop_name.trim());
        this.toast.show(res?.message || 'Application submitted!', 'success');
      },
      error: (err) => {
        this.submitting.set(false);
        this.toast.show(err?.error?.detail || 'Could not submit application', 'error');
      },
    });
  }
}
