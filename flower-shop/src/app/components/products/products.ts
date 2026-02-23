import { Component, OnInit } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { ProductService } from '../../services/product';
import { CartService } from '../../services/cart';
import { FeedbackService } from '../../services/feedback';
import { Product } from '../../models/product.model';

@Component({
  selector: 'app-products',
  imports: [RouterLink],
  templateUrl: './products.html',
  styleUrl: './products.scss'
})
export class Products implements OnInit {
  products: Product[] = [];
  filteredProducts: Product[] = [];
  categories: string[] = [];
  selectedCategory: string = 'All';
  sortBy: string = 'name';
  searchQuery: string = '';
  cartQuantities: { [productId: number]: number } = {};

  constructor(
    private productService: ProductService,
    private cartService: CartService,
    private route: ActivatedRoute,
    private feedbackService: FeedbackService
  ) {}

  ngOnInit(): void {
    this.products = this.productService.getProducts();
    this.categories = ['All', ...this.productService.getCategories()];

    this.route.queryParams.subscribe(params => {
      if (params['category']) {
        this.selectedCategory = params['category'];
      }
      if (params['search']) {
        this.searchQuery = params['search'];
      }
      this.filterProducts();
    });
  }

  filterProducts(): void {
    let filtered = [...this.products];

    // Filter by category
    if (this.selectedCategory !== 'All') {
      filtered = filtered.filter(p => p.category === this.selectedCategory);
    }

    // Filter by search query
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query) ||
        p.category.toLowerCase().includes(query)
      );
    }

    this.filteredProducts = filtered;
    this.sortProducts();
  }

  onCategoryChange(category: string): void {
    this.selectedCategory = category;
    this.filterProducts();
  }

  onSortChange(event: Event): void {
    this.sortBy = (event.target as HTMLSelectElement).value;
    this.sortProducts();
  }

  sortProducts(): void {
    switch (this.sortBy) {
      case 'price-low':
        this.filteredProducts.sort((a, b) => a.price - b.price);
        break;
      case 'price-high':
        this.filteredProducts.sort((a, b) => b.price - a.price);
        break;
      case 'rating':
        this.filteredProducts.sort((a, b) => b.rating - a.rating);
        break;
      default:
        this.filteredProducts.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  getQuantity(productId: number): number {
    return this.cartQuantities[productId] || 0;
  }

  addToCart(product: Product): void {
    this.cartQuantities[product.id] = 1;
    this.cartService.addToCart(product);
    this.feedbackService.addToCartFeedback();
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
    } else {
      this.cartQuantities[product.id] = current - 1;
      this.cartService.updateQuantity(product.id, current - 1);
    }
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.filterProducts();
  }
}
