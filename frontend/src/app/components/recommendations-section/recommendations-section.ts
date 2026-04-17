import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth';
import { CartService } from '../../services/cart';
import { ProductService } from '../../services/product';
import { ToastService } from '../../services/toast';
import { FadeInDirective } from '../../directives/fade-in';
import { environment } from '../../../environments/environment';

interface RecoProduct {
  id: number;
  name: string;
  price: number;
  image: string;
  category: string;
  rating?: number;
  inStock?: boolean;
}

interface RecommendationsResponse {
  based_on_last_order: { reason: string; products: RecoProduct[] };
  popular_in_city:     { city: string;   products: RecoProduct[] };
  trending_this_week:  { products: RecoProduct[] };
}

@Component({
  selector: 'app-recommendations-section',
  standalone: true,
  imports: [FadeInDirective],
  templateUrl: './recommendations-section.html',
  styleUrl: './recommendations-section.scss'
})
export class RecommendationsSection implements OnInit {
  loading   = signal(true);
  data      = signal<RecommendationsResponse | null>(null);
  addingId  = signal<number | null>(null);

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private cartService: CartService,
    private productService: ProductService,
    private toastService: ToastService,
    private router: Router
  ) {}

  ngOnInit(): void {
    const email = this.authService.user()?.email ?? '';
    const url = `${environment.apiUrl}/api/recommendations${email ? '?email=' + encodeURIComponent(email) : ''}`;
    this.http.get<RecommendationsResponse>(url).subscribe({
      next: (d) => { this.data.set(d); this.loading.set(false); },
      error: ()  => this.loading.set(false)
    });
  }

  get basedOnOrder() { return this.data()?.based_on_last_order; }
  get popularCity()  { return this.data()?.popular_in_city; }
  get trending()     { return this.data()?.trending_this_week; }

  hasSections(): boolean {
    const d = this.data();
    if (!d) return false;
    return (
      (d.based_on_last_order.products.length > 0) ||
      (d.popular_in_city.products.length > 0) ||
      (d.trending_this_week.products.length > 0)
    );
  }

  addToCart(reco: RecoProduct): void {
    this.addingId.set(reco.id);
    const product = this.productService.getProductById(reco.id);
    if (product) {
      this.cartService.addToCart(product);
      this.toastService.show(`${reco.name} added to cart 🛒`);
    }
    setTimeout(() => this.addingId.set(null), 800);
  }

  goToProduct(id: number): void {
    this.router.navigate(['/products', id]);
  }
}
