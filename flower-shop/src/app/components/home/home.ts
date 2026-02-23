import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProductService } from '../../services/product';
import { CartService } from '../../services/cart';
import { FeedbackService } from '../../services/feedback';
import { Product } from '../../models/product.model';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home implements OnInit {
  products: Product[] = [];
  filteredProducts: Product[] = [];
  categories: string[] = [];
  selectedCategory: string = 'All';
  cartQuantities: { [productId: number]: number } = {};

  toastVisible = signal(false);
  toastProductName = signal('');
  toastType = signal<'added' | 'removed'>('added');
  private toastTimer: any;

  constructor(
    private productService: ProductService,
    private cartService: CartService,
    private feedbackService: FeedbackService
  ) {}

  ngOnInit(): void {
    this.products = this.productService.getProducts();
    this.categories = this.productService.getCategories();
    this.filteredProducts = this.products;
  }

  scrollToCollection(): void {
    document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth' });
  }

  selectCategory(category: string): void {
    this.selectedCategory = category;
    this.filteredProducts = category === 'All'
      ? this.products
      : this.products.filter(p => p.category === category);
  }

  getQuantity(productId: number): number {
    return this.cartQuantities[productId] || 0;
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
