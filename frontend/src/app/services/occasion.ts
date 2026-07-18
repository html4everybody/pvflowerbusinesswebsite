import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, tap } from 'rxjs';
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
  product_ids: string[];
  active: boolean;
  sort_order: number;
}

@Injectable({ providedIn: 'root' })
export class OccasionService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;
  private cache: StoreOccasion[] | null = null;

  /** Cached after the first fetch (home preloads it), so occasion clicks are instant. */
  getAll(): Observable<StoreOccasion[]> {
    if (this.cache) return of(this.cache);
    return this.http.get<StoreOccasion[]>(`${this.base}/api/store-occasions`).pipe(
      tap(d => this.cache = d)
    );
  }

  clearCache(): void { this.cache = null; }
}
