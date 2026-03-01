import { Component, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ProductService } from '../../services/product';
import { CartService } from '../../services/cart';
import { FeedbackService } from '../../services/feedback';
import { SearchService } from '../../services/search';
import { WishlistService } from '../../services/wishlist';
import { PromoService, OffersData, BundleDeal } from '../../services/promo';
import { Product } from '../../models/product.model';
import { FadeInDirective } from '../../directives/fade-in';

@Component({
  selector: 'app-home',
  imports: [RouterLink, FadeInDirective],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home implements OnInit {
  products: Product[] = [];
  categories: string[] = [];
  selectedCategory: string = 'All';
  cartQuantities: { [productId: number]: number } = {};

  toastVisible = signal(false);
  toastProductName = signal('');
  toastType = signal<'added' | 'removed'>('added');
  private toastTimer: any;

  offers = signal<OffersData | null>(null);
  copiedCode = signal('');
  private copiedTimer: any;

  constructor(
    private productService: ProductService,
    private cartService: CartService,
    private feedbackService: FeedbackService,
    public searchService: SearchService,
    public wishlistService: WishlistService,
    private promoService: PromoService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.products = this.productService.getProducts();
    this.categories = this.productService.getCategories();
    this.promoService.getOffers().subscribe({ next: d => this.offers.set(d), error: () => {} });
  }

  copyCode(code: string): void {
    navigator.clipboard.writeText(code).then(() => {
      this.copiedCode.set(code);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copiedCode.set(''), 2000);
    });
  }

  addBundleToCart(bundle: BundleDeal): void {
    for (const product of bundle.products) {
      this.cartService.addToCart(product as unknown as Product, 1);
    }
    sessionStorage.setItem('floran_promo', bundle.promo_code);
    this.router.navigate(['/cart']);
  }

  get filteredProducts(): Product[] {
    const byCategory = this.selectedCategory === 'All'
      ? this.products
      : this.products.filter(p => p.category === this.selectedCategory);
    return this.searchService.filterProducts(byCategory);
  }

  scrollToCollection(): void {
    document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth' });
  }

  selectCategory(category: string): void {
    this.selectedCategory = category;
  }

  getQuantity(productId: number): number {
    return this.cartQuantities[productId] || 0;
  }

  // Deterministic low-stock: ids divisible by 7 or ending in 3 show urgency
  isLowStock(productId: number): boolean {
    return productId % 7 === 0 || productId % 10 === 3;
  }

  lowStockCount(productId: number): number {
    return (productId % 4) + 2; // returns 2–5
  }

  private showToast(name: string, type: 'added' | 'removed'): void {
    this.toastProductName.set(name);
    this.toastType.set(type);
    this.toastVisible.set(true);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastVisible.set(false);
    }, 2500);
  }

  addToCart(product: Product): void {
    this.cartQuantities[product.id] = 1;
    this.cartService.addToCart(product);
    this.feedbackService.addToCartFeedback();
    this.showToast(product.name, 'added');
  }

  incrementQuantity(product: Product): void {
    this.cartQuantities[product.id] = (this.cartQuantities[product.id] || 0) + 1;
    this.cartService.addToCart(product);
    this.feedbackService.addToCartFeedback();
  }

  decrementQuantity(product: Product): void {
    const current = this.cartQuantities[product.id] || 0;
    if (current <= 1) {
      delete this.cartQuantities[product.id];
      this.cartService.removeFromCart(product.id);
      this.feedbackService.removeFromCartFeedback();
      this.showToast(product.name, 'removed');
    } else {
      this.cartQuantities[product.id] = current - 1;
      this.cartService.updateQuantity(product.id, current - 1);
    }
  }
}
