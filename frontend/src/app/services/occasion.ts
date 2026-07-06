import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface StoreOccasion {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  story: string;
  quote: string;
  emoji: string;
  hero_image: string;
  gradient: string;
  accent_color: string;
  product_ids: number[];
  active: boolean;
  sort_order: number;
}

@Injectable({ providedIn: 'root' })
export class OccasionService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  getAll(): Observable<StoreOccasion[]> {
    return this.http.get<StoreOccasion[]>(`${this.base}/api/store-occasions`);
  }
}
