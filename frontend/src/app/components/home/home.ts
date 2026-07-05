import { Component, OnInit, AfterViewInit, ViewChild, ElementRef, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ProductService } from '../../services/product';
import { CartService } from '../../services/cart';
import { FeedbackService } from '../../services/feedback';
import { SearchService } from '../../services/search';
import { WishlistService } from '../../services/wishlist';
import { PromoService, OffersData, BundleDeal, SeasonalOffer } from '../../services/promo';
import { AuthService } from '../../services/auth';
import { Product } from '../../models/product.model';
import { FadeInDirective } from '../../directives/fade-in';

@Component({
  selector: 'app-home',
  imports: [RouterLink, FadeInDirective, DecimalPipe],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home implements OnInit, AfterViewInit {
  @ViewChild('heroVideo') heroVideoRef!: ElementRef<HTMLVideoElement>;
  products: Product[] = [];
  categories: string[] = [];
  selectedCategory: string = 'All';
  cartQuantities: { [productId: number]: number } = {};

  toastVisible = signal(false);
  toastProductName = signal('');
  toastType = signal<'added' | 'removed' | 'wish-added' | 'wish-removed'>('added');
  private toastTimer: any;

  offers = signal<OffersData | null>(null);
  copiedCode = signal('');
  appliedCode = signal('');
  private copiedTimer: any;
  private appliedTimer: any;

  constructor(
    private productService: ProductService,
    private cartService: CartService,
    private feedbackService: FeedbackService,
    public searchService: SearchService,
    public wishlistService: WishlistService,
    private promoService: PromoService,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.products = this.productService.getProducts();
    this.categories = this.productService.getCategories();
    this.promoService.getOffers(this.authService.user()?.email).subscribe({ next: d => this.offers.set(d), error: () => {} });
  }

  ngAfterViewInit(): void {
    const video = this.heroVideoRef?.nativeElement;
    if (video) {
      video.muted = true;
      video.play().catch(() => {});
    }
  }

  goToProduct(productId: number): void {
    this.router.navigate(['/products', productId]);
  }

  copyCode(code: string): void {
    navigator.clipboard.writeText(code).then(() => {
      this.copiedCode.set(code);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copiedCode.set(''), 2000);
    });
  }

  // Live Deal helpers ───────────────────────────────────────────────
  discountLabel(o: SeasonalOffer): string {
    if (o.discount_type === 'percent' && o.discount_value != null) return `${o.discount_value}% OFF`;
    if (o.discount_type === 'flat' && o.discount_value != null) return `₹${o.discount_value} OFF`;
    return 'Special Deal';
  }

  conditionLabel(o: SeasonalOffer): string {
    if (o.first_order_only) return 'First order only';
    if (o.min_order && o.min_order > 0) return `On orders above ₹${o.min_order}`;
    return 'No minimum spend';
  }

  applyDeal(offer: SeasonalOffer): void {
    sessionStorage.setItem('viva_promo', offer.code);
    this.appliedCode.set(offer.code);
    clearTimeout(this.appliedTimer);
    this.appliedTimer = setTimeout(() => this.appliedCode.set(''), 2500);
    this.scrollToCollection();
  }

  addBundleToCart(bundle: BundleDeal): void {
    for (const product of bundle.products) {
      this.cartService.addToCart(product as unknown as Product, 1);
    }
    sessionStorage.setItem('viva_promo', bundle.promo_code);
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

  isLowStock(productId: number): boolean {
    return productId % 7 === 0 || productId % 10 === 3;
  }

  lowStockCount(productId: number): number {
    return (productId % 4) + 2;
  }

  private showToast(name: string, type: 'added' | 'removed' | 'wish-added' | 'wish-removed'): void {
    this.toastProductName.set(name);
    this.toastType.set(type);
    this.toastVisible.set(true);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastVisible.set(false);
    }, 2500);
  }

  toggleWishlist(product: Product, event: Event): void {
    event.stopPropagation();
    const wasWishlisted = this.wishlistService.has(product.id);
    this.wishlistService.toggle(product);
    this.showToast(product.name, wasWishlisted ? 'wish-removed' : 'wish-added');
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
