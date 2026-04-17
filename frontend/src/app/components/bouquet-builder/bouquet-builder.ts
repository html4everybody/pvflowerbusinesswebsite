import { Component, OnInit, signal } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { TitleCasePipe } from '@angular/common';
import { BouquetService } from '../../services/bouquet';
import { ProductService } from '../../services/product';
import { CartService } from '../../services/cart';
import { Product } from '../../models/product.model';
import { ArrangementStyle, BouquetSize } from '../../models/bouquet.model';

@Component({
  selector: 'app-bouquet-builder',
  imports: [RouterLink, TitleCasePipe],
  templateUrl: './bouquet-builder.html',
  styleUrl: './bouquet-builder.scss',
})
export class BouquetBuilder implements OnInit {
  allProducts: Product[] = [];
  paletteProducts: Product[] = [];
  draggingProduct: Product | null = null;
  isDragOver = false;

  shareVisible = signal(false);
  shareUrl = signal('');
  addedToCart = signal(false);

  private shareTimer: any;
  private cartTimer: any;

  constructor(
    public bouquet: BouquetService,
    private productService: ProductService,
    private cartService: CartService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.allProducts = this.productService.getProducts().filter(p =>
      ['Flowers', 'Bouquets', 'Garlands', 'Flower Braids'].includes(p.category)
    );
    this.paletteProducts = this.allProducts;

    this.route.queryParams.subscribe(params => {
      if (params['d']) {
        this.bouquet.loadFromEncoded(params['d']);
      }
    });
  }

  filterPalette(event: Event): void {
    const q = (event.target as HTMLInputElement).value.toLowerCase();
    this.paletteProducts = q
      ? this.allProducts.filter(p =>
          p.name.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)
        )
      : this.allProducts;
  }

  // ── Drag & Drop ─────────────────────────────────────────────────────────────
  onDragStart(product: Product): void {
    this.draggingProduct = product;
  }

  onDragEnd(): void {
    this.draggingProduct = null;
    this.isDragOver = false;
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = true;
  }

  onDragLeave(): void {
    this.isDragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = false;
    if (this.draggingProduct) {
      this.bouquet.addFlower(this.draggingProduct);
      this.draggingProduct = null;
    }
  }

  // ── Bouquet Visual ──────────────────────────────────────────────────────────
  get visualFlowers(): Array<{ image: string; name: string }> {
    const result: Array<{ image: string; name: string }> = [];
    for (const f of this.bouquet.design().flowers) {
      for (let i = 0; i < f.count; i++) {
        result.push({ image: f.image, name: f.name });
      }
    }
    return result.slice(0, 12);
  }

  private flowerAngle(index: number, total: number): number {
    if (total === 1) return 0;
    const spread = Math.min(72, 18 + total * 6);
    return -spread + (2 * spread / (total - 1)) * index;
  }

  getFlowerLeft(index: number, total: number): string {
    const rad = (this.flowerAngle(index, total) * Math.PI) / 180;
    const radius = 82 + Math.min(total * 4, 36);
    const x = Math.sin(rad) * radius;
    return `calc(50% + ${x.toFixed(1)}px - 32px)`;
  }

  getFlowerBottom(index: number, total: number): string {
    const rad = (this.flowerAngle(index, total) * Math.PI) / 180;
    const radius = 82 + Math.min(total * 4, 36);
    const y = Math.cos(rad) * radius;
    return `calc(40% + ${y.toFixed(1)}px)`;
  }

  getFlowerZIndex(index: number, total: number): number {
    const mid = Math.floor(total / 2);
    return 10 + mid - Math.abs(index - mid);
  }

  isInBouquet(productId: number): boolean {
    return this.bouquet.design().flowers.some(f => f.productId === productId);
  }

  getProductCount(productId: number): number {
    return this.bouquet.design().flowers.find(f => f.productId === productId)?.count ?? 0;
  }

  castStyle(id: string): ArrangementStyle { return id as ArrangementStyle; }
  castSize(id: string): BouquetSize { return id as BouquetSize; }

  // ── Actions ─────────────────────────────────────────────────────────────────
  shareDesign(): void {
    const url = this.bouquet.getShareUrl();
    this.shareUrl.set(url);
    this.shareVisible.set(true);
    navigator.clipboard?.writeText(url).catch(() => {});
    clearTimeout(this.shareTimer);
    this.shareTimer = setTimeout(() => this.shareVisible.set(false), 4000);
  }

  addToCart(): void {
    if (this.bouquet.design().flowers.length === 0) return;
    this.cartService.addToCart(this.bouquet.getCartProduct());
    this.addedToCart.set(true);
    clearTimeout(this.cartTimer);
    this.cartTimer = setTimeout(() => this.addedToCart.set(false), 2500);
  }
}
