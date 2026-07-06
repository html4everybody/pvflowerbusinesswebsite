import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { ProductService } from '../../services/product';
import { CartService } from '../../services/cart';
import { FeedbackService } from '../../services/feedback';
import { ToastService } from '../../services/toast';
import { WishlistService } from '../../services/wishlist';
import { OccasionService, StoreOccasion } from '../../services/occasion';
import { Product } from '../../models/product.model';

export interface OccasionConfig {
  slug: string;
  title: string;
  tagline: string;
  story: string;
  quote: string;
  emoji: string;
  heroImage: string;
  gradient: string;
  accentColor: string;
  productIds: number[];
}

@Component({
  selector: 'app-occasion-page',
  imports: [RouterLink, DecimalPipe],
  templateUrl: './occasion-page.html',
  styleUrl: './occasion-page.scss',
})
export class OccasionPage implements OnInit {
  allOccasions: OccasionConfig[] = [];
  config: OccasionConfig | null = null;
  products: Product[] = [];
  isIndex = false;
  cartQuantities: { [id: number]: number } = {};

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private productService: ProductService,
    private cartService: CartService,
    private feedbackService: FeedbackService,
    private toastService: ToastService,
    private occasionService: OccasionService,
    public wishlistService: WishlistService,
  ) {}

  goToProduct(id: number): void {
    this.router.navigate(['/products', id]);
  }

  private mapOcc(o: StoreOccasion): OccasionConfig {
    return {
      slug: o.slug, title: o.title, tagline: o.tagline, story: o.story, quote: o.quote,
      emoji: o.emoji, heroImage: o.hero_image, gradient: o.gradient,
      accentColor: o.accent_color, productIds: o.product_ids || [],
    };
  }

  ngOnInit(): void {
    this.occasionService.getAll().subscribe({
      next: list => { this.allOccasions = list.map(o => this.mapOcc(o)); this.handleRoute(); },
      error: () => this.handleRoute(),
    });
    this.route.params.subscribe(() => this.handleRoute());
  }

  private handleRoute(): void {
    const slug = this.route.snapshot.params['slug'];
    if (!slug) { this.isIndex = true; this.config = null; return; }
    this.config = this.allOccasions.find(o => o.slug === slug) ?? null;
    if (!this.config) { this.isIndex = this.allOccasions.length > 0; return; }
    this.isIndex = false;
    this.cartQuantities = {};
    this.loadProducts();
  }

  get otherOccasions(): OccasionConfig[] {
    return this.allOccasions.filter(o => o.slug !== this.config?.slug);
  }

  private loadProducts(): void {
    if (!this.config) return;
    this.products = (this.config.productIds || [])
      .map(id => this.productService.getProductById(id))
      .filter((p): p is Product => !!p)
      .slice(0, 12);
  }

  getQuantity(productId: number): number {
    return this.cartQuantities[productId] || 0;
  }

  addToCart(product: Product): void {
    this.cartQuantities[product.id] = 1;
    this.cartService.addToCart(product);
    this.feedbackService.addToCartFeedback();
    this.toastService.show(`${product.name} added to cart!`);
  }

  incrementQuantity(product: Product): void {
    this.cartQuantities[product.id] = (this.cartQuantities[product.id] || 0) + 1;
    this.cartService.addToCart(product);
    this.feedbackService.addToCartFeedback();
  }

  scrollToProducts(): void {
    document.getElementById('occ-products')?.scrollIntoView({ behavior: 'smooth' });
  }

  decrementQuantity(product: Product): void {
    const current = this.cartQuantities[product.id] || 0;
    if (current <= 1) {
      delete this.cartQuantities[product.id];
      this.cartService.removeFromCart(product.id);
      this.feedbackService.removeFromCartFeedback();
    } else {
      this.cartQuantities[product.id] = current - 1;
      this.cartService.updateQuantity(product.id, current - 1);
    }
  }
}
