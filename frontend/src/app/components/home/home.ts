import { Component, OnInit, AfterViewInit, ViewChild, ElementRef, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { ProductService } from '../../services/product';
import { CartService } from '../../services/cart';
import { FeedbackService } from '../../services/feedback';
import { SearchService } from '../../services/search';
import { WishlistService } from '../../services/wishlist';
import { PromoService, OffersData, BundleDeal, SeasonalOffer } from '../../services/promo';
import { AuthService } from '../../services/auth';
import { SubscriptionService } from '../../services/subscription';
import { OccasionService, StoreOccasion } from '../../services/occasion';
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
  cartQuantities: { [productId: number]: number } = {};

  // Category is a single source of truth shared with the search facet, so
  // picking a category in search reflects in the collection tabs (and vice-versa).
  get selectedCategory(): string { return this.searchService.selectedCategory() || 'All'; }

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
    private subscriptionService: SubscriptionService,
    private occasionService: OccasionService,
    private router: Router,
    private route: ActivatedRoute,
    private location: Location
  ) {}

  subDeliveryToday = signal(false);
  occasions = signal<StoreOccasion[]>([]);

  ngOnInit(): void {
    this.products = this.productService.getProducts();
    this.categories = this.productService.getCategories();
    this.promoService.getOffers(this.authService.user()?.email).subscribe({ next: d => this.offers.set(d), error: () => {} });
    this.occasionService.getAll().subscribe({ next: d => this.occasions.set(d), error: () => {} });

    // Heads-up if the logged-in user has a Bloom Plan delivery due today
    const user = this.authService.user();
    if (user?.email) {
      this.subscriptionService.getAll(user.email).subscribe({
        next: subs => {
          const today = new Date().toISOString().slice(0, 10);
          this.subDeliveryToday.set(subs.some(s => s.status === 'active' && (s.next_delivery || '').slice(0, 10) === today));
        },
        error: () => {}
      });
    }

    // Header "Live Deals" / "Bundle Offers" navigate here with ?scrollTo=<id>.
    // The home page owns those sections, so it scrolls once they've rendered.
    this.route.queryParams.subscribe(params => {
      if (params['scrollTo']) this.scrollToSection(params['scrollTo']);
    });
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

  // The single best percentage deal / highest-saving bundle get a premium highlight
  get bestOfferId(): string | null {
    let id: string | null = null, best = 0;
    for (const o of this.offers()?.seasonal_offers ?? []) {
      if (o.discount_type === 'percent' && (o.discount_value ?? 0) > best) { best = o.discount_value!; id = o.id; }
    }
    return id;
  }
  get bestBundleId(): string | null {
    let id: string | null = null, best = -1;
    for (const b of this.offers()?.bundle_deals ?? []) {
      if ((b.savings_amount ?? 0) > best) { best = b.savings_amount ?? 0; id = b.id; }
    }
    return id;
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
    // Category, query, occasion, colour and price are all handled by the service.
    return this.searchService.filterProducts(this.products);
  }

  scrollToCollection(): void {
    document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth' });
  }

  // Poll for the section (it only exists after offers render), scroll to it,
  // then clear the query param so the link works again on the next click.
  // Use Location.replaceState (not router.navigate) so clearing the param
  // does NOT fire a NavigationEnd — which would scroll the page back to top.
  private scrollToSection(id: string, attempts = 0): void {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
      this.location.replaceState('/');
    } else if (attempts < 30) {
      setTimeout(() => this.scrollToSection(id, attempts + 1), 100);
    }
  }

  selectCategory(category: string): void {
    this.searchService.selectedCategory.set(category === 'All' ? '' : category);
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
    this.cartService.addToCart(product);
    this.cartQuantities[product.id] = 1;
    this.feedbackService.addToCartFeedback();
    this.showToast(product.name, 'added');
  }

  incrementQuantity(product: Product): void {
    if (!this.cartService.addToCart(product)) return;
    this.cartQuantities[product.id] = (this.cartQuantities[product.id] || 0) + 1;
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
