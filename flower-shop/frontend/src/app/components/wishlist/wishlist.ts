import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ProductService } from '../../services/product';
import { WishlistService } from '../../services/wishlist';
import { CartService } from '../../services/cart';
import { FeedbackService } from '../../services/feedback';
import { Product } from '../../models/product.model';

@Component({
  selector: 'app-wishlist',
  imports: [RouterLink],
  templateUrl: './wishlist.html',
  styleUrl: './wishlist.scss'
})
export class Wishlist implements OnInit {
  isSharedView = false;
  sharedIds: number[] = [];
  shareVisible = signal(false);
  private shareTimer: any;

  constructor(
    private route: ActivatedRoute,
    private productService: ProductService,
    public wishlistService: WishlistService,
    private cartService: CartService,
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
      }
    });
  }

  get displayProducts(): Product[] {
    const ids = this.isSharedView ? this.sharedIds : this.wishlistService.getIds();
    return ids
      .map(id => this.productService.getProductById(id))
      .filter((p): p is Product => p !== undefined);
  }

  addToCart(product: Product): void {
    this.cartService.addToCart(product);
    this.feedbackService.addToCartFeedback();
  }

  moveAllToCart(): void {
    this.displayProducts.forEach(p => this.cartService.addToCart(p));
    this.feedbackService.addToCartFeedback();
  }

  saveSharedToWishlist(): void {
    this.sharedIds.forEach(id => {
      const product = this.productService.getProductById(id);
      if (product && !this.wishlistService.has(id)) {
        this.wishlistService.toggle(product);
      }
    });
  }

  saveOneToWishlist(product: Product): void {
    if (!this.wishlistService.has(product.id)) {
      this.wishlistService.toggle(product);
    }
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
