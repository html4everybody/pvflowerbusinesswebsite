import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Product } from '../models/product.model';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ProductService {
  private productsSignal = signal<Product[]>([]);

  constructor(private http: HttpClient) {}

  loadProducts(): Promise<void> {
    return firstValueFrom(
      this.http.get<any[]>(`${environment.apiUrl}/api/products`)
    ).then(data => {
      this.productsSignal.set(data.map(p => ({
        ...p,
        inStock: p.inStock ?? p.in_stock ?? true,
        rating: p.rating ?? 4.5
      })));
    }).catch(() => {});
  }

  getProducts(): Product[] {
    return this.productsSignal();
  }

  getProductById(id: number): Product | undefined {
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
