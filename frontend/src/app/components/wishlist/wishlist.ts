import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { ProductService } from '../../services/product';
import { WishlistService } from '../../services/wishlist';
import { CartService } from '../../services/cart';
import { AuthService } from '../../services/auth';
import { ToastService } from '../../services/toast';
import { FeedbackService } from '../../services/feedback';
import { Product } from '../../models/product.model';

@Component({
  selector: 'app-wishlist',
  imports: [RouterLink, DecimalPipe],
  templateUrl: './wishlist.html',
  styleUrl: './wishlist.scss'
})
export class Wishlist implements OnInit {
  isSharedView = false;
  sharedIds: number[] = [];
  shareVisible = signal(false);
  toastVisible = signal(false);
  toastProductName = signal('');
  private shareTimer: any;
  private toastTimer: any;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private productService: ProductService,
    public wishlistService: WishlistService,
    private cartService: CartService,
    private authService: AuthService,
    private toastService: ToastService,
    private feedbackService: FeedbackService
  ) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      if (params['ids']) {
        this.sharedIds = (params['ids'] as string)
          .split(',')
          .map(Number)
          .filter(n => !isNaN(n) && n > 0);
        this.isSharedView = this.sharedIds.length > 0;

        // Auto-complete a pending save that was interrupted by the signin flow
        const pending = sessionStorage.getItem('wishlist_pending_save');
        if (pending && this.authService.isLoggedIn()) {
          sessionStorage.removeItem('wishlist_pending_save');
          const pendingIds = JSON.parse(pending) as number[];
          pendingIds.forEach(id => {
            const product = this.productService.getProductById(id);
            if (product && !this.wishlistService.has(id)) this.wishlistService.toggle(product);
          });
          this.toastService.show('Items saved to your wishlist!');
          this.router.navigate(['/wishlist']);
        }
      } else if (!this.authService.isLoggedIn()) {
        this.toastService.show('Please sign in to continue.', 'error');
        setTimeout(() => this.router.navigate(['/signin']), 150);
      }
    });
  }

  get displayProducts(): Product[] {
    const ids = this.isSharedView ? this.sharedIds : this.wishlistService.getIds();
    return ids
      .map(id => this.productService.getProductById(id))
      .filter((p): p is Product => p !== undefined);
  }

  private showToast(name: string): void {
    this.toastProductName.set(name);
    this.toastVisible.set(true);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastVisible.set(false), 2500);
  }

  addToCart(product: Product): void {
    this.cartService.addToCart(product);
    this.feedbackService.addToCartFeedback();
    this.showToast(product.name);
  }

  moveAllToCart(): void {
    this.displayProducts.forEach(p => this.cartService.addToCart(p));
    this.feedbackService.addToCartFeedback();
    this.showToast('All items');
  }

  saveSharedToWishlist(): void {
    if (!this.authService.isLoggedIn()) {
      sessionStorage.setItem('wishlist_pending_save', JSON.stringify(this.sharedIds));
      this.toastService.show('Please sign in to save items to your wishlist.', 'error');
      setTimeout(() => this.router.navigate(['/signin'], { queryParams: { returnUrl: this.router.url } }), 150);
      return;
    }
    this.sharedIds.forEach(id => {
      const product = this.productService.getProductById(id);
      if (product && !this.wishlistService.has(id)) this.wishlistService.toggle(product);
    });
    this.toastService.show('Items saved to your wishlist!');
  }

  saveOneToWishlist(product: Product): void {
    if (!this.authService.isLoggedIn()) {
      sessionStorage.setItem('wishlist_pending_save', JSON.stringify([product.id]));
      this.toastService.show('Please sign in to save items to your wishlist.', 'error');
      setTimeout(() => this.router.navigate(['/signin'], { queryParams: { returnUrl: this.router.url } }), 150);
      return;
    }
    if (!this.wishlistService.has(product.id)) this.wishlistService.toggle(product);
  }

  goToProduct(id: number): void {
    this.router.navigate(['/products', id]);
  }

  getQuantity(id: number): number {
    return this.cartService.items().find(i => i.product.id === id)?.quantity ?? 0;
  }

  incrementQuantity(product: Product): void {
    this.cartService.addToCart(product);
  }

  decrementQuantity(product: Product): void {
    const qty = this.getQuantity(product.id);
    this.cartService.updateQuantity(product.id, qty - 1);
  }

  shareWishlist(): void {
    const url = this.wishlistService.getShareUrl();
    navigator.clipboard.writeText(url).then(() => {
      this.shareVisible.set(true);
      clearTimeout(this.shareTimer);
      this.shareTimer = setTimeout(() => this.shareVisible.set(false), 3500);
    });
  }
}
