import { Component, signal, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { AuthService } from '../../services/auth';
import { LoyaltyService, LoyaltyData, LoyaltyConfig, Reward, RewardClaim } from '../../services/loyalty';
import { ToastService } from '../../services/toast';
import { ConfirmService } from '../../services/confirm';

interface Tier { key: string; icon: string; min: number; perk: string; accent: string; }

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

  config = signal<LoyaltyConfig>({
    points_per_rupee: 1, welcome_bonus: 100, referral_signup_bonus: 200,
    referral_purchase_bonus: 150, redemption_rate: 10,
  });
  catalog = signal<Reward[]>([]);
  myClaims = signal<RewardClaim[]>([]);
  claimingId = signal<string | null>(null);

  // Floral tiers themed for "Petal Rewards" — recognition milestones for
  // lifetime points earned. These previously claimed bonus-point
  // multipliers, free delivery, and priority support at each tier, none of
  // which exist anywhere in the backend (earn rate is a single flat
  // platform-wide setting, see config() below) — customers who "reached"
  // a tier were being told they'd unlocked perks they never actually got.
  readonly TIERS: Tier[] = [
    { key: 'Sprout',      icon: 'bi-flower3', min: 0,    perk: 'Welcome to Petal Rewards — every order earns points',        accent: '#84cc16' },
    { key: 'Bloom',       icon: 'bi-flower1', min: 500,  perk: 'A regular — thank you for coming back to us',                accent: '#ec4899' },
    { key: 'Blossom',     icon: 'bi-flower2', min: 1500, perk: 'A cherished customer — we appreciate your loyalty',          accent: '#a855f7' },
    { key: 'Petal Elite', icon: 'bi-gem',     min: 5000, perk: 'Our top tier — thank you for being one of our best',         accent: '#f59e0b' },
  ];

  constructor(
    public authService: AuthService,
    private loyaltyService: LoyaltyService,
    private router: Router,
    private toast: ToastService,
    private confirmService: ConfirmService,
  ) {}

  ngOnInit(): void {
    const user = this.authService.user();
    if (!user) {
      this.router.navigate(['/signin']);
      return;
    }
    this.loyaltyService.getAccount(user.email, this.authService.getToken()).subscribe({
      next: data => { this.account.set(data); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
    this.loyaltyService.getConfig().subscribe({
      next: cfg => this.config.set(cfg),
      error: () => {},
    });
    this.loyaltyService.getCatalog().subscribe({
      next: rewards => this.catalog.set(rewards),
      error: () => {},
    });
    this.loadMyClaims(user.email);
  }

  loadMyClaims(email: string): void {
    const token = this.authService.getToken();
    if (!token) return;
    this.loyaltyService.getMyClaims(email, token).subscribe({
      next: claims => this.myClaims.set(claims),
      error: () => {},
    });
  }

  canClaim(reward: Reward): boolean { return this.balance >= reward.points_cost; }

  async claimReward(reward: Reward): Promise<void> {
    if (!this.canClaim(reward) || this.claimingId()) return;
    const ok = await this.confirmService.ask({
      title: 'Claim this reward?',
      message: `"${reward.title}" costs ${reward.points_cost} points — they'll be deducted from your balance right away.`,
      confirmText: 'Claim',
    });
    if (!ok) return;
    const token = this.authService.getToken();
    if (!token) return;
    this.claimingId.set(reward.id);
    this.loyaltyService.claimReward(token, reward.id).subscribe({
      next: (claim) => {
        this.claimingId.set(null);
        this.toast.show(`Claimed! Use code ${claim.code} at checkout.`);
        const user = this.authService.user();
        if (user) {
          this.loadMyClaims(user.email);
          this.loyaltyService.getAccount(user.email, token).subscribe({ next: d => this.account.set(d), error: () => {} });
        }
      },
      error: (err) => {
        this.claimingId.set(null);
        this.toast.show(err?.error?.detail || 'Could not claim this reward', 'error');
      },
    });
  }

  copyVoucherCode(code: string): void {
    navigator.clipboard.writeText(code).then(() => this.toast.show('Code copied'));
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
      case 'earned_purchase': return 'bi-bag-check-fill';
      case 'earned_referral_signup': return 'bi-person-plus-fill';
      case 'earned_referral_purchase': return 'bi-gift-fill';
      case 'earned_welcome': return 'bi-stars';
      case 'redeemed': return 'bi-cash-coin';
      case 'refund_redeemed': return 'bi-arrow-counterclockwise';
      default: return 'bi-star-fill';
    }
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
