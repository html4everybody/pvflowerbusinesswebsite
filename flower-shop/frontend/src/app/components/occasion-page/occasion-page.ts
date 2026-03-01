import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ProductService } from '../../services/product';
import { CartService } from '../../services/cart';
import { FeedbackService } from '../../services/feedback';
import { ToastService } from '../../services/toast';
import { WishlistService } from '../../services/wishlist';
import { Product } from '../../models/product.model';

export interface OccasionConfig {
  slug: string;
  title: string;
  tagline: string;
  story: string;
  quote: string;
  emoji: string;
  heroImage: string;
  gradient: string;
  accentColor: string;
  keywords: string[];
  usePriceFilter?: boolean;
  minPrice?: number;
}

export const OCCASIONS: OccasionConfig[] = [
  {
    slug: 'birthday',
    title: 'Birthday Celebrations',
    tagline: 'Make their day unforgettable',
    story: 'Birthdays are milestones worth celebrating with the most vibrant blooms you can find. Whether they turn 7 or 70, a curated flower arrangement makes every birthday feel truly special — brighter than a cake, more lasting than a card, and more personal than anything else.',
    quote: '"A bouquet of flowers is the one gift that never goes out of style."',
    emoji: '🎂',
    heroImage: 'https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=1400&q=85',
    gradient: 'linear-gradient(135deg, rgba(232,67,147,0.82) 0%, rgba(255,170,80,0.72) 100%)',
    accentColor: '#e84393',
    keywords: ['birthday', 'celebrat', 'festiv', 'carnival', 'congratulat', 'colorful', 'vibrant'],
  },
  {
    slug: 'wedding',
    title: 'Wedding Flowers',
    tagline: 'For the love story of a lifetime',
    story: 'Every wedding deserves flowers as beautiful as the vows exchanged. From bridal bouquets to sweeping table centrepieces, our wedding collection transforms any venue into a floral fairytale — elegant, timeless, and absolutely breathtaking in every detail.',
    quote: '"Where flowers bloom, so does hope — and love."',
    emoji: '💍',
    heroImage: 'https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=1400&q=85',
    gradient: 'linear-gradient(135deg, rgba(255,240,215,0.88) 0%, rgba(220,170,130,0.80) 100%)',
    accentColor: '#b8713a',
    keywords: ['wedding', 'bridal', 'bridesmaid', 'bride', 'groom', 'corsage', 'boutonniere', 'centrepiece', 'centerpiece'],
  },
  {
    slug: 'sympathy',
    title: 'Sympathy & Comfort',
    tagline: 'When words fall short, flowers speak',
    story: 'In moments of grief and loss, flowers offer something words cannot — a gentle, living reminder that love endures. Our sympathy arrangements are thoughtfully chosen to honour a life and offer quiet, heartfelt solace to those left behind.',
    quote: '"Grief is love with nowhere to go. Let flowers carry it gently forward."',
    emoji: '🕊️',
    heroImage: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=1400&q=85',
    gradient: 'linear-gradient(135deg, rgba(210,228,255,0.90) 0%, rgba(170,200,245,0.82) 100%)',
    accentColor: '#3a6fba',
    keywords: ['sympathy', 'white', 'pure', 'serene', 'peace', 'lily', 'serenity', 'get well', 'recovery', 'wishes'],
  },
  {
    slug: 'romance',
    title: 'Romance & Love',
    tagline: 'Say it with flowers, say it from the heart',
    story: "Love is in the details — and nothing expresses it more beautifully than hand-picked roses and blooms chosen just for them. Whether it's a first date or a golden anniversary, let flowers tell the story your heart already knows by heart.",
    quote: '"Love is a flower. You\'ve got to let it grow." — John Lennon',
    emoji: '❤️',
    heroImage: 'https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=1400&q=85',
    gradient: 'linear-gradient(135deg, rgba(200,40,100,0.85) 0%, rgba(255,100,140,0.75) 100%)',
    accentColor: '#c84b7a',
    keywords: ['romance', 'romantic', 'love', 'valentine', 'rose', 'passion', 'peony', 'bloom', 'heart'],
  },
  {
    slug: 'corporate',
    title: 'Corporate Gifting',
    tagline: 'Elevate every professional relationship',
    story: "First impressions matter — and lasting ones matter even more. Impress clients, reward your team, or elevate your workspace with premium floral arrangements that speak to your brand's commitment to thoughtfulness, quality, and genuine excellence.",
    quote: '"The best investment is one that makes people feel genuinely valued."',
    emoji: '🏢',
    heroImage: 'https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=1400&q=85',
    gradient: 'linear-gradient(135deg, rgba(20,40,70,0.90) 0%, rgba(50,90,160,0.82) 100%)',
    accentColor: '#2c4a7c',
    keywords: ['luxury', 'premium', 'grand', 'deluxe', 'elegant', 'exotic', 'centerpiece', 'bonsai', 'orchid'],
    usePriceFilter: true,
    minPrice: 55,
  },
];

@Component({
  selector: 'app-occasion-page',
  imports: [RouterLink],
  templateUrl: './occasion-page.html',
  styleUrl: './occasion-page.scss',
})
export class OccasionPage implements OnInit {
  readonly allOccasions = OCCASIONS;
  config: OccasionConfig | null = null;
  products: Product[] = [];
  isIndex = false;
  cartQuantities: { [id: number]: number } = {};

  constructor(
    private route: ActivatedRoute,
    private productService: ProductService,
    private cartService: CartService,
    private feedbackService: FeedbackService,
    private toastService: ToastService,
    public wishlistService: WishlistService,
  ) {}

  ngOnInit(): void {
    this.route.params.subscribe(params => {
      const slug = params['slug'];
      if (!slug) {
        this.isIndex = true;
        this.config = null;
        return;
      }
      this.config = OCCASIONS.find(o => o.slug === slug) ?? null;
      if (!this.config) {
        this.isIndex = true;
        return;
      }
      this.isIndex = false;
      this.cartQuantities = {};
      this.loadProducts();
    });
  }

  get otherOccasions(): OccasionConfig[] {
    return this.allOccasions.filter(o => o.slug !== this.config?.slug);
  }

  private loadProducts(): void {
    if (!this.config) return;
    const all = this.productService.getProducts();
    const cfg = this.config;

    const matched = new Set<number>();
    const result: Product[] = [];

    // keyword match
    for (const p of all) {
      const text = (p.name + ' ' + p.description).toLowerCase();
      if (cfg.keywords.some(k => text.includes(k.toLowerCase()))) {
        matched.add(p.id);
        result.push(p);
      }
    }

    // price fallback for corporate
    if (cfg.usePriceFilter && cfg.minPrice !== undefined) {
      for (const p of all) {
        if (!matched.has(p.id) && p.price >= cfg.minPrice) {
          result.push(p);
        }
      }
    }

    this.products = result.sort((a, b) => b.rating - a.rating).slice(0, 12);
  }

  getQuantity(productId: number): number {
    return this.cartQuantities[productId] || 0;
  }

  addToCart(product: Product): void {
    this.cartQuantities[product.id] = 1;
    this.cartService.addToCart(product);
    this.feedbackService.addToCartFeedback();
    this.toastService.show(`${product.name} added to cart!`);
  }

  incrementQuantity(product: Product): void {
    this.cartQuantities[product.id] = (this.cartQuantities[product.id] || 0) + 1;
    this.cartService.addToCart(product);
    this.feedbackService.addToCartFeedback();
  }

  scrollToProducts(): void {
    document.getElementById('occ-products')?.scrollIntoView({ behavior: 'smooth' });
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
}
