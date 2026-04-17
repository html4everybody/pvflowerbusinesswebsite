import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface PromoResult {
  valid: boolean;
  code: string;
  discount_type: 'percent' | 'flat';
  discount_value: number;
  discount_amount: number;
  description: string;
}

export interface SeasonalOffer {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
  code: string;
  badge: string;
}

export interface BundleProduct {
  id: number;
  name: string;
  description: string;
  price: number;
  image: string;
  category: string;
  inStock: boolean;
}

export interface BundleDeal {
  id: string;
  name: string;
  description: string;
  emoji: string;
  product_ids: number[];
  promo_code: string;
  savings_pct: number;
  products: BundleProduct[];
  original_price: number;
  bundle_price: number;
}

export interface OffersData {
  seasonal_offers: SeasonalOffer[];
  bundle_deals: BundleDeal[];
}

@Injectable({ providedIn: 'root' })
export class PromoService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  validateCode(code: string, orderTotal: number, email?: string): Observable<PromoResult> {
    return this.http.post<PromoResult>(`${this.apiUrl}/api/promo/validate`, {
      code,
      order_total: orderTotal,
      customer_email: email ?? null
    });
  }

  getOffers(): Observable<OffersData> {
    return this.http.get<OffersData>(`${this.apiUrl}/api/offers`);
  }
}
