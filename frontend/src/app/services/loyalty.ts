import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface LoyaltyAccount {
  user_email: string;
  points_balance: number;
  points_earned_total: number;
  referral_code: string;
  referred_by_code?: string;
  created_at: string;
}

export interface LoyaltyTransaction {
  id: string;
  user_email: string;
  type: string;
  points: number;
  description: string;
  order_id?: string;
  created_at: string;
}

export interface LoyaltyData extends LoyaltyAccount {
  transactions: LoyaltyTransaction[];
  pending_points?: number;
}

export interface LoyaltyConfig {
  points_per_rupee: number;
  welcome_bonus: number;
  referral_signup_bonus: number;
  referral_purchase_bonus: number;
  redemption_rate: number;
}

export interface Reward {
  id: string;
  title: string;
  description?: string;
  points_cost: number;
  discount_value: number;
  min_order: number;
  active: boolean;
}

export interface RewardClaim {
  id: string;
  user_email: string;
  reward_id: string;
  code: string;
  title: string;
  discount_value: number;
  min_order: number;
  points_spent: number;
  used: boolean;
  used_order_id?: string;
  claimed_at: string;
}

@Injectable({ providedIn: 'root' })
export class LoyaltyService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getAccount(email: string, token: string): Observable<LoyaltyData> {
    return this.http.get<LoyaltyData>(`${this.apiUrl}/api/loyalty?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`);
  }

  getConfig(): Observable<LoyaltyConfig> {
    return this.http.get<LoyaltyConfig>(`${this.apiUrl}/api/loyalty-config`);
  }

  getCatalog(): Observable<Reward[]> {
    return this.http.get<Reward[]>(`${this.apiUrl}/api/rewards/catalog`);
  }

  claimReward(token: string, rewardId: string): Observable<RewardClaim> {
    return this.http.post<RewardClaim>(`${this.apiUrl}/api/rewards/claim`, { token, reward_id: rewardId });
  }

  getMyClaims(email: string, token: string): Observable<RewardClaim[]> {
    return this.http.get<RewardClaim[]>(`${this.apiUrl}/api/rewards/my-claims?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`);
  }
}
