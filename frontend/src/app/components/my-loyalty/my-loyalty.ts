import { Component, signal, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { AuthService } from '../../services/auth';
import { LoyaltyService, LoyaltyData } from '../../services/loyalty';

interface Tier { key: string; emoji: string; min: number; perk: string; accent: string; }

@Component({
  selector: 'app-my-loyalty',
  imports: [RouterLink, DecimalPipe],
  templateUrl: './my-loyalty.html',
  styleUrl: './my-loyalty.scss'
})
export class MyLoyalty implements OnInit {
  account = signal<LoyaltyData | null>(null);
  loading = signal(true);
  copySuccess = signal(false);

  // Floral tiers themed for "Petal Rewards"
  readonly TIERS: Tier[] = [
    { key: 'Sprout',      emoji: '🌱', min: 0,    perk: 'Earn 1 point for every ₹1 you spend',    accent: '#84cc16' },
    { key: 'Bloom',       emoji: '🌷', min: 500,  perk: '+5% bonus points on every order',        accent: '#ec4899' },
    { key: 'Blossom',     emoji: '🌺', min: 1500, perk: 'Free delivery + 10% bonus points',       accent: '#a855f7' },
    { key: 'Petal Elite', emoji: '💎', min: 5000, perk: 'Priority support + 15% bonus points',    accent: '#f59e0b' },
  ];

  readonly REDEEM = [
    { points: 500,  value: 50 },
    { points: 1000, value: 100 },
    { points: 2500, value: 250 },
    { points: 5000, value: 550 },
  ];

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
      next: data => { this.account.set(data); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  get earned(): number { return this.account()?.points_earned_total ?? 0; }
  get balance(): number { return this.account()?.points_balance ?? 0; }
  get pending(): number { return this.account()?.pending_points ?? 0; }

  get tierIndex(): number {
    let idx = 0;
    this.TIERS.forEach((t, i) => { if (this.earned >= t.min) idx = i; });
    return idx;
  }
  get currentTier(): Tier { return this.TIERS[this.tierIndex]; }
  get nextTier(): Tier | null { return this.TIERS[this.tierIndex + 1] ?? null; }

  get tierProgress(): number {
    const next = this.nextTier;
    if (!next) return 100;
    const from = this.currentTier.min;
    return Math.min(100, Math.max(0, Math.round(((this.earned - from) / (next.min - from)) * 100)));
  }
  get pointsToNext(): number {
    return this.nextTier ? Math.max(0, this.nextTier.min - this.earned) : 0;
  }

  get memberName(): string {
    const u = this.authService.user();
    if (!u) return 'Member';
    return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || 'Member';
  }
  get memberSince(): string {
    const c = this.account()?.created_at;
    return c ? new Date(c).getFullYear().toString() : '';
  }
  get referralCount(): number {
    return (this.account()?.transactions ?? []).filter(t => (t.type || '').includes('referral')).length;
  }

  isRedeemable(points: number): boolean { return this.balance >= points; }

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
      case 'refund_redeemed': return '↩️';
      default: return '⭐';
    }
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
