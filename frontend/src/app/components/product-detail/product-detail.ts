import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ProductService } from '../../services/product';
import { CartService } from '../../services/cart';
import { FeedbackService } from '../../services/feedback';
import { ToastService } from '../../services/toast';
import { WishlistService } from '../../services/wishlist';
import { AuthService } from '../../services/auth';
import { Product, formatQty, unitPriceLabel } from '../../models/product.model';
import { ProductExtrasService, CareTip, Review } from '../../services/product-extras';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-product-detail',
  imports: [RouterLink, FormsModule],
  templateUrl: './product-detail.html',
  styleUrl: './product-detail.scss'
})
export class ProductDetail implements OnInit {
  product: Product | undefined;
  quantity = 1;
  relatedProducts: Product[] = [];

  activeTab = signal<'description' | 'care' | 'reviews'>('description');
  activeImageIdx = signal(0);
  weightUnit = signal<'grams' | 'kgs'>('kgs');

  gallery: string[] = [];
  careTips: CareTip[] = [];
  reviews: Review[] = [];
  fbt: Product[] = [];
  fbtChecked = new Set<string>();

  // ── Review state ────────────────────────────────────────────────────────────
  loadingReviews  = signal(true);
  submittingReview = signal(false);
  reviewSubmitted = signal(false);
  canReviewStatus = signal<{ can_review: boolean; has_purchased: boolean; already_reviewed: boolean } | null>(null);
  hoverRating     = signal(0);

  reviewForm = {
    rating: 5,
    text: '',
    photos: [] as { preview: string; b64: string }[]
  };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private productService: ProductService,
    private cartService: CartService,
    private feedbackService: FeedbackService,
    private toastService: ToastService,
    public wishlistService: WishlistService,
    private extrasService: ProductExtrasService,
    private http: HttpClient,
    public authService: AuthService
  ) {}

  ngOnInit(): void {
    this.route.params.subscribe(params => {
      const id = params['id'] as string;
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
      this.loadReviews(this.product.id);
      if (this.authService.user()) {
        this.loadCanReview(this.product.id);
      }
      this.fbt = this.extrasService.getFrequentlyBoughtTogether(this.product);
      this.fbtChecked = new Set(this.fbt.map(p => p.id));
      this.activeImageIdx.set(0);
      this.activeTab.set('description');
      const type = this.product.unit_type || 'stem';
      this.quantity = type === 'weight' ? 1 : (this.product.min_quantity || 1);
      this.weightUnit.set('kgs');
    });
  }

  get unitType(): string { return this.product?.unit_type || 'stem'; }

  get minQty(): number {
    if (this.unitType === 'weight') return this.weightUnit() === 'grams' ? 0.1 : 1;
    return this.product?.min_quantity || 1;
  }

  // Stepper display value: raw grams (100, 200…) in grams mode, raw kg (1, 2…) in kg mode
  get stepperValue(): number {
    if (this.unitType === 'weight') {
      return this.weightUnit() === 'grams'
        ? Math.round(this.quantity * 1000)
        : this.quantity;
    }
    return this.quantity;
  }

  get presets(): { qty: number; label: string }[] {
    if (!this.product) return [];
    const type = this.product.unit_type || 'stem';
    const minQ = this.product.min_quantity || 1;
    if (type === 'pair') {
      return [1, 2, 5, 10].map(m => ({ qty: m, label: formatQty(m, this.product!) }));
    }
    // stem — multiples of min_quantity
    return [1, 2, 5, 10].map(m => ({ qty: m * minQ, label: formatQty(m * minQ, this.product!) }));
  }

  get priceUnitLabel(): string {
    return this.product ? unitPriceLabel(this.product) : '';
  }

  setWeightUnit(unit: 'grams' | 'kgs'): void {
    if (unit === 'kgs') {
      this.quantity = Math.max(1, Math.round(this.quantity));
    } else {
      this.quantity = 0.1; // default to 100g when switching to grams
    }
    this.weightUnit.set(unit);
  }

  decreaseQuantity(): void {
    if (this.unitType === 'weight') {
      const step = this.weightUnit() === 'grams' ? 0.1 : 1;
      const next = Math.round((this.quantity - step) * 1000) / 1000;
      if (next >= this.minQty) this.quantity = next;
    } else {
      if (this.quantity > this.minQty) this.quantity--;
    }
  }

  increaseQuantity(): void {
    if (this.unitType === 'weight') {
      const step = this.weightUnit() === 'grams' ? 0.1 : 1;
      this.quantity = Math.round((this.quantity + step) * 1000) / 1000;
    } else {
      this.quantity++;
    }
  }

  setPresetQty(qty: number): void {
    this.quantity = qty;
  }

  addToCart(): void {
    if (this.product) {
      this.cartService.addToCart(this.product, this.quantity);
      this.feedbackService.addToCartFeedback();
      this.toastService.show(`${this.product.name} added to cart!`);
      this.quantity = this.minQty;
    }
  }

  selectImage(i: number): void {
    this.activeImageIdx.set(i);
  }

  toggleFbt(id: string): void {
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

  round(n: number): number {
    return Math.round(n);
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

  // ── Review methods ───────────────────────────────────────────────────────────
  loadReviews(productId: string): void {
    this.loadingReviews.set(true);
    this.http.get<any[]>(`${environment.apiUrl}/api/reviews?product_id=${productId}`).subscribe({
      next: (data) => {
        this.reviews = (data || []).map(r => ({
          id: r.id,
          author: r.author_name,
          avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(r.author_name)}&background=6366f1&color=fff&size=60&bold=true`,
          rating: r.rating,
          date: new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
          text: r.review_text,
          photos: r.photo_urls || [],
          verified: r.verified_purchase
        }));
        this.loadingReviews.set(false);
      },
      error: () => {
        this.reviews = [];
        this.loadingReviews.set(false);
      }
    });
  }

  loadCanReview(productId: string): void {
    const email = this.authService.user()?.email;
    if (!email) return;
    this.http.get<any>(`${environment.apiUrl}/api/reviews/can-review?product_id=${productId}&email=${encodeURIComponent(email)}`).subscribe({
      next: (s) => this.canReviewStatus.set(s),
      error: () => {}
    });
  }

  setReviewRating(n: number): void {
    this.reviewForm.rating = n;
  }

  onPhotoSelected(event: Event): void {
    const files = (event.target as HTMLInputElement).files;
    if (!files) return;
    for (const file of Array.from(files)) {
      if (this.reviewForm.photos.length >= 3) break;
      this.compressImage(file).then(p => {
        if (this.reviewForm.photos.length < 3) {
          this.reviewForm.photos.push(p);
        }
      });
    }
    (event.target as HTMLInputElement).value = '';
  }

  removePhoto(i: number): void {
    this.reviewForm.photos.splice(i, 1);
  }

  private compressImage(file: File): Promise<{ preview: string; b64: string }> {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 800;
        let w = img.width, h = img.height;
        if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve({ preview: dataUrl, b64: dataUrl.split(',')[1] });
      };
      img.src = url;
    });
  }

  submitReview(): void {
    if (!this.reviewForm.text.trim() || !this.product) return;
    this.submittingReview.set(true);
    const user = this.authService.user();
    const body = {
      product_id: this.product.id,
      user_email: user.email,
      author_name: `${user.firstName} ${(user.lastName ?? '').charAt(0)}.`.trim(),
      rating: this.reviewForm.rating,
      review_text: this.reviewForm.text,
      photo_b64_list: this.reviewForm.photos.map(p => p.b64)
    };
    this.http.post<any>(`${environment.apiUrl}/api/reviews`, body).subscribe({
      next: (saved) => {
        this.submittingReview.set(false);
        this.reviewSubmitted.set(true);
        this.canReviewStatus.update(s => s ? { ...s, can_review: false, already_reviewed: true } : s);
        // Prepend to reviews list
        this.reviews = [{
          id: saved.id,
          author: body.author_name,
          avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(body.author_name)}&background=6366f1&color=fff&size=60&bold=true`,
          rating: body.rating,
          date: 'Just now',
          text: body.review_text,
          photos: this.reviewForm.photos.map(p => p.preview),
          verified: saved.verified_purchase ?? false
        }, ...this.reviews];
        this.reviewForm = { rating: 5, text: '', photos: [] };
        this.toastService.show('Review submitted! Thank you 🌸');
      },
      error: (err) => {
        this.submittingReview.set(false);
        this.toastService.show(err.error?.detail || 'Failed to submit review.', 'error');
      }
    });
  }
}
