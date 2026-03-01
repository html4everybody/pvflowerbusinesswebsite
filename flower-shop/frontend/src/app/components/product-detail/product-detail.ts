import { Component, HostListener, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProductService } from '../../services/product';
import { CartService } from '../../services/cart';
import { FeedbackService } from '../../services/feedback';
import { ToastService } from '../../services/toast';
import { WishlistService } from '../../services/wishlist';
import { Product } from '../../models/product.model';
import { ProductExtrasService, CareTip, Review } from '../../services/product-extras';

@Component({
  selector: 'app-product-detail',
  imports: [RouterLink],
  templateUrl: './product-detail.html',
  styleUrl: './product-detail.scss'
})
export class ProductDetail implements OnInit {
  product: Product | undefined;
  quantity = 1;
  relatedProducts: Product[] = [];

  activeTab = signal<'description' | 'care' | 'reviews'>('description');
  activeImageIdx = signal(0);
  lightboxOpen = signal(false);
  zoomActive = signal(false);
  zoomOrigin = signal('50% 50%');

  gallery: string[] = [];
  careTips: CareTip[] = [];
  reviews: Review[] = [];
  fbt: Product[] = [];
  fbtChecked = new Set<number>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private productService: ProductService,
    private cartService: CartService,
    private feedbackService: FeedbackService,
    private toastService: ToastService,
    public wishlistService: WishlistService,
    private extrasService: ProductExtrasService
  ) {}

  ngOnInit(): void {
    this.route.params.subscribe(params => {
      const id = +params['id'];
      this.product = this.productService.getProductById(id);

      if (!this.product) {
        this.router.navigate(['/products']);
        return;
      }

      this.relatedProducts = this.productService
        .getProductsByCategory(this.product.category)
        .filter(p => p.id !== this.product!.id)
        .slice(0, 4);

      this.gallery = this.extrasService.getGalleryImages(this.product);
      this.careTips = this.extrasService.getCareTips(this.product.category);
      this.reviews = this.extrasService.getReviews(this.product.id);
      this.fbt = this.extrasService.getFrequentlyBoughtTogether(this.product);
      this.fbtChecked = new Set(this.fbt.map(p => p.id));
      this.activeImageIdx.set(0);
      this.activeTab.set('description');
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.lightboxOpen()) this.closeLightbox();
  }

  decreaseQuantity(): void {
    if (this.quantity > 1) this.quantity--;
  }

  increaseQuantity(): void {
    this.quantity++;
  }

  addToCart(): void {
    if (this.product) {
      this.cartService.addToCart(this.product, this.quantity);
      this.feedbackService.addToCartFeedback();
      this.toastService.show(`${this.product.name} added to cart!`);
      this.quantity = 1;
    }
  }

  selectImage(i: number): void {
    this.activeImageIdx.set(i);
  }

  openLightbox(): void {
    this.lightboxOpen.set(true);
  }

  closeLightbox(): void {
    this.lightboxOpen.set(false);
  }

  prevImage(): void {
    this.activeImageIdx.set(
      (this.activeImageIdx() - 1 + this.gallery.length) % this.gallery.length
    );
  }

  nextImage(): void {
    this.activeImageIdx.set(
      (this.activeImageIdx() + 1) % this.gallery.length
    );
  }

  onMouseMove(e: MouseEvent): void {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    this.zoomOrigin.set(`${x.toFixed(1)}% ${y.toFixed(1)}%`);
  }

  toggleFbt(id: number): void {
    if (this.fbtChecked.has(id)) {
      this.fbtChecked.delete(id);
    } else {
      this.fbtChecked.add(id);
    }
    this.fbtChecked = new Set(this.fbtChecked);
  }

  addFbtToCart(): void {
    if (!this.product) return;
    this.cartService.addToCart(this.product, 1);
    for (const p of this.fbt) {
      if (this.fbtChecked.has(p.id)) {
        this.cartService.addToCart(p, 1);
      }
    }
    this.feedbackService.addToCartFeedback();
    this.toastService.show('Items added to cart!');
  }

  get avgRating(): number {
    if (!this.reviews.length) return this.product?.rating ?? 0;
    return this.reviews.reduce((sum, r) => sum + r.rating, 0) / this.reviews.length;
  }

  get ratingCounts(): number[] {
    const counts = [0, 0, 0, 0, 0]; // index 0 = 5★, index 4 = 1★
    for (const r of this.reviews) {
      counts[5 - r.rating]++;
    }
    return counts;
  }

  get fbtTotal(): number {
    let total = this.product?.price ?? 0;
    for (const p of this.fbt) {
      if (this.fbtChecked.has(p.id)) total += p.price;
    }
    return total;
  }
}
