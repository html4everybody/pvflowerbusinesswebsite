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
}

@Injectable({ providedIn: 'root' })
export class LoyaltyService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getAccount(email: string): Observable<LoyaltyData> {
    return this.http.get<LoyaltyData>(`${this.apiUrl}/api/loyalty?email=${encodeURIComponent(email)}`);
  }
}
