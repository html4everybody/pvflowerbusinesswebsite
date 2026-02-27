import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProductService } from '../../services/product';
import { CartService } from '../../services/cart';
import { FeedbackService } from '../../services/feedback';
import { ToastService } from '../../services/toast';
import { Product } from '../../models/product.model';

@Component({
  selector: 'app-product-detail',
  imports: [RouterLink],
  templateUrl: './product-detail.html',
  styleUrl: './product-detail.scss'
})
export class ProductDetail implements OnInit {
  product: Product | undefined;
  quantity: number = 1;
  relatedProducts: Product[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private productService: ProductService,
    private cartService: CartService,
    private feedbackService: FeedbackService,
    private toastService: ToastService
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
    });
  }

  decreaseQuantity(): void {
    if (this.quantity > 1) {
      this.quantity--;
    }
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
}
