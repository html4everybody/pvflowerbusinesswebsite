import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Subscription {
  id: string;
  customer_email: string;
  customer_name: string;
  plan: 'weekly' | 'biweekly' | 'monthly';
  style: 'seasonal' | 'fixed';
  fixed_product_id?: number;
  fixed_product_name?: string;
  status: 'active' | 'paused' | 'cancelled';
  next_delivery: string;
  address: string;
  skipped_count: number;
  created_at: string;
}

export interface CreateSubscriptionRequest {
  customer_email: string;
  customer_name: string;
  plan: string;
  style: string;
  fixed_product_id?: number;
  fixed_product_name?: string;
  address: string;
}

@Injectable({ providedIn: 'root' })
export class SubscriptionService {
  private base = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getAll(email: string): Observable<Subscription[]> {
    return this.http.get<Subscription[]>(`${this.base}/api/subscriptions?email=${encodeURIComponent(email)}`);
  }

  create(req: CreateSubscriptionRequest): Observable<{ id: string; status: string; next_delivery: string }> {
    return this.http.post<any>(`${this.base}/api/subscriptions`, req);
  }

  pause(id: string): Observable<any> {
    return this.http.patch(`${this.base}/api/subscriptions/${id}/pause`, {});
  }

  resume(id: string): Observable<any> {
    return this.http.patch(`${this.base}/api/subscriptions/${id}/resume`, {});
  }

  skip(id: string): Observable<{ status: string; next_delivery: string }> {
    return this.http.patch<any>(`${this.base}/api/subscriptions/${id}/skip`, {});
  }

  cancel(id: string): Observable<any> {
    return this.http.patch(`${this.base}/api/subscriptions/${id}/cancel`, {});
  }
}
