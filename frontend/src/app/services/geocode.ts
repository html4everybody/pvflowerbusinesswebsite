import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface GeocodeResult {
  display_name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
}

@Injectable({
  providedIn: 'root'
})
export class GeocodeService {
  constructor(private http: HttpClient) {}

  search(query: string): Promise<GeocodeResult[]> {
    if (!query || query.trim().length < 3) return Promise.resolve([]);
    return firstValueFrom(
      this.http.get<GeocodeResult[]>(`${environment.apiUrl}/api/geocode/search`, { params: { q: query } })
    ).catch(() => []);
  }

  reverse(lat: number, lon: number): Promise<GeocodeResult | null> {
    return firstValueFrom(
      this.http.get<GeocodeResult>(`${environment.apiUrl}/api/geocode/reverse`, { params: { lat, lon } })
    ).catch(() => null);
  }
}
