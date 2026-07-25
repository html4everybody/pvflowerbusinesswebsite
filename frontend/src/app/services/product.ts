import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { retry } from 'rxjs/operators';
import { Product } from '../models/product.model';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ProductService {
  private productsSignal = signal<Product[]>([]);
  // A failed initial fetch used to silently blank the storefront for the
  // whole session — most components trust getProducts() is already
  // populated and never re-check, so there was no retry and no way to
  // recover short of a hard refresh.
  readonly loadError = signal(false);

  constructor(private http: HttpClient) {}

  private applyProducts(data: any[]): void {
    this.productsSignal.set(data.map(p => ({
      ...p,
      inStock: p.inStock ?? p.in_stock ?? true,
      rating: p.rating ?? 4.5
    })));
    this.loadError.set(false);
  }

  loadProducts(): Promise<void> {
    return firstValueFrom(
      this.http.get<any[]>(`${environment.apiUrl}/api/products`).pipe(retry({ count: 3, delay: 1500 }))
    ).then(data => {
      this.applyProducts(data);
    }).catch(() => {
      // APP_INITIALIZER can't block bootstrap forever — let the app start
      // (with whatever was cached, likely nothing) but keep retrying in the
      // background so a transient blip self-heals without a hard refresh.
      this.loadError.set(true);
      this.retryInBackground();
    });
  }

  private retryInBackground(delayMs: number = 5000): void {
    setTimeout(() => {
      this.http.get<any[]>(`${environment.apiUrl}/api/products`).subscribe({
        next: (data) => this.applyProducts(data),
        error: () => this.retryInBackground(Math.min(delayMs * 2, 60000)),
      });
    }, delayMs);
  }

  getProducts(): Product[] {
    return this.productsSignal();
  }

  getProductById(id: string): Product | undefined {
    return this.productsSignal().find(p => p.id === id);
  }

  getProductsByCategory(category: string): Product[] {
    return this.productsSignal().filter(p => p.category === category);
  }

  getCategories(): string[] {
    return [...new Set(this.productsSignal().map(p => p.category))];
  }

  getFeaturedProducts(): Product[] {
    return this.productsSignal().filter(p => p.rating >= 4.8).slice(0, 6);
  }
}
