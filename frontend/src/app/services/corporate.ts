import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CorporateItem {
  product_id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
}

export interface CorporateOrder {
  id: string;
  company_name?: string;
  event_type?: string;
  theme?: string;
  contact_name: string;
  contact_email: string;
  items?: CorporateItem[];
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  total_amount: number;
  final_amount: number;
  branding_logo_url?: string;
  branding_message?: string;
  delivery_address: string;
  delivery_date?: string;
  is_recurring: boolean;
  recurring_day?: string;
  recurring_frequency?: string;
  next_delivery?: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  admin_message?: string;
  created_at: string;
}

export interface CreateCorporateOrderRequest {
  company_name?: string;
  event_type?: string;
  theme?: string;
  contact_name: string;
  contact_email: string;
  items: CorporateItem[];
  branding_logo_url?: string;
  branding_message?: string;
  delivery_address: string;
  delivery_date?: string;
}

@Injectable({ providedIn: 'root' })
export class CorporateService {
  private base = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getAll(email: string): Observable<CorporateOrder[]> {
    return this.http.get<CorporateOrder[]>(
      `${this.base}/api/corporate-orders?email=${encodeURIComponent(email)}`
    );
  }

  create(req: CreateCorporateOrderRequest): Observable<{ id: string; final_amount: number; next_delivery?: string }> {
    return this.http.post<any>(`${this.base}/api/corporate-orders`, req);
  }

  cancel(id: string, token: string): Observable<any> {
    return this.http.patch(`${this.base}/api/corporate-orders/${id}/cancel?token=${encodeURIComponent(token)}`, {});
  }

  skip(id: string, token: string): Observable<{ next_delivery: string }> {
    return this.http.patch<any>(`${this.base}/api/corporate-orders/${id}/skip?token=${encodeURIComponent(token)}`, {});
  }
}
