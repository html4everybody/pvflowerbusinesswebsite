import { Component, signal, computed, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth';
import { LoyaltyService, LoyaltyData } from '../../services/loyalty';

@Component({
  selector: 'app-my-loyalty',
  imports: [RouterLink],
  templateUrl: './my-loyalty.html',
  styleUrl: './my-loyalty.scss'
})
export class MyLoyalty implements OnInit {
  account = signal<LoyaltyData | null>(null);
  loading = signal(true);
  copySuccess = signal(false);

  constructor(
    public authService: AuthService,
    private loyaltyService: LoyaltyService,
    private router: Router
  ) {}

  ngOnInit(): void {
    const user = this.authService.user();
    if (!user) {
      this.router.navigate(['/signin']);
      return;
    }
    this.loyaltyService.getAccount(user.email).subscribe({
      next: data => {
        this.account.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  get tier(): { label: string; emoji: string; next: number } {
    const e = this.account()?.points_earned_total ?? 0;
    if (e >= 5000) return { label: 'Platinum', emoji: '💎', next: 0 };
    if (e >= 1500) return { label: 'Gold', emoji: '🥇', next: 5000 };
    if (e >= 500)  return { label: 'Silver', emoji: '🥈', next: 1500 };
    return { label: 'Bronze', emoji: '🥉', next: 500 };
  }

  get tierProgress(): number {
    const e = this.account()?.points_earned_total ?? 0;
    const t = this.tier;
    if (t.next === 0) return 100;
    const thresholds = [0, 500, 1500, 5000];
    const tierIndex = ['Bronze','Silver','Gold','Platinum'].indexOf(t.label);
    const from = thresholds[tierIndex];
    return Math.min(100, Math.round(((e - from) / (t.next - from)) * 100));
  }

  get shareUrl(): string {
    const code = this.account()?.referral_code ?? '';
    return `${window.location.origin}/signin?ref=${code}`;
  }

  copyReferralLink(): void {
    navigator.clipboard.writeText(this.shareUrl).then(() => {
      this.copySuccess.set(true);
      setTimeout(() => this.copySuccess.set(false), 2000);
    });
  }

  typeIcon(type: string): string {
    switch (type) {
      case 'earned_purchase': return '🛍️';
      case 'earned_referral_signup': return '👥';
      case 'earned_referral_purchase': return '🎁';
      case 'earned_welcome': return '🎉';
      case 'redeemed': return '💸';
      default: return '⭐';
    }
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
