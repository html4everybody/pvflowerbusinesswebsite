import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth';

export interface SavedAddress {
  id: string;
  user_email: string;
  label: string;
  address: string;
  city: string | null;
  state: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
  created_at: string;
}

export interface SavedAddressInput {
  label: string;
  address: string;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  is_default?: boolean;
}

@Injectable({ providedIn: 'root' })
export class AddressesService {
  private base = environment.apiUrl;

  constructor(private http: HttpClient, private auth: AuthService) {}

  list(): Observable<SavedAddress[]> {
    return this.http.get<SavedAddress[]>(`${this.base}/api/addresses`, { params: { token: this.auth.getToken() } });
  }

  create(input: SavedAddressInput): Observable<SavedAddress> {
    return this.http.post<SavedAddress>(`${this.base}/api/addresses`, { token: this.auth.getToken(), ...input });
  }

  update(id: string, input: Partial<SavedAddressInput>): Observable<SavedAddress> {
    return this.http.put<SavedAddress>(`${this.base}/api/addresses/${id}`, { token: this.auth.getToken(), ...input });
  }

  remove(id: string): Observable<any> {
    return this.http.delete(`${this.base}/api/addresses/${id}`, { params: { token: this.auth.getToken() } });
  }
}
