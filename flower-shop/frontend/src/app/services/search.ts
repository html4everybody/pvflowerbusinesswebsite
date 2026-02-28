import { Injectable, signal } from '@angular/core';
import { Product } from '../models/product.model';

export type PriceRange = 'all' | 'budget' | 'mid' | 'premium';

@Injectable({ providedIn: 'root' })
export class SearchService {
  readonly query = signal('');
  readonly selectedOccasion = signal('');
  readonly selectedColor = signal('');
  readonly priceRange = signal<PriceRange>('all');

  readonly occasions = [
    'Birthday', 'Wedding', 'Anniversary', 'Sympathy',
    'Romance', 'Get Well', 'New Baby', 'Mothers Day', 'Congratulations'
  ];

  readonly colors = [
    { name: 'Red',    hex: '#e53e3e' },
    { name: 'Pink',   hex: '#ed64a6' },
    { name: 'White',  hex: '#e8e8e8' },
    { name: 'Yellow', hex: '#d69e2e' },
    { name: 'Purple', hex: '#805ad5' },
    { name: 'Orange', hex: '#dd6b20' },
    { name: 'Blue',   hex: '#3182ce' },
    { name: 'Mixed',  hex: 'conic-gradient(#e53e3e 0deg, #ed64a6 60deg, #ecc94b 120deg, #48bb78 180deg, #3182ce 240deg, #805ad5 300deg, #e53e3e 360deg)' },
  ];

  readonly priceLabels: Record<string, string> = {
    budget:  'Budget · Under $35',
    mid:     'Mid · $35–$70',
    premium: 'Premium · $70+',
  };

  // ── Derived tags from product text ─────────────────────────────────────────

  private getOccasionTags(p: Product): string[] {
    const text = (p.name + ' ' + p.description).toLowerCase();
    const tags: string[] = [];
    if (/birthday|celebrat|festiv/.test(text))          tags.push('Birthday');
    if (/wedding|bridal|bridesmaid|bride/.test(text))   tags.push('Wedding');
    if (/anniversary/.test(text))                        tags.push('Anniversary');
    if (/sympathy|condol|memorial/.test(text))           tags.push('Sympathy');
    if (/romance|romantic|love|valentine/.test(text))    tags.push('Romance');
    if (/congratulat|achievem/.test(text))               tags.push('Congratulations');
    if (/get well|recovery|wishes/.test(text))           tags.push('Get Well');
    if (/baby|newborn/.test(text))                       tags.push('New Baby');
    if (/mother|mom/.test(text))                         tags.push('Mothers Day');
    return tags;
  }

  private getColorTags(p: Product): string[] {
    const name = p.name.toLowerCase();
    const tags: string[] = [];
    if (/\bred\b/.test(name))                                     tags.push('Red');
    if (/pink|blush|coral|peach|rose/.test(name))                 tags.push('Pink');
    if (/white|pure|ivory|snow/.test(name))                       tags.push('White');
    if (/yellow|gold|sunshine|sunny/.test(name))                  tags.push('Yellow');
    if (/purple|lavender|violet|royal/.test(name))                tags.push('Purple');
    if (/orange/.test(name))                                      tags.push('Orange');
    if (/blue/.test(name))                                        tags.push('Blue');
    if (/mixed|rainbow|assorted|tropical|exotic|colorful/.test(name)) tags.push('Mixed');
    return tags;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getSuggestions(products: Product[]): Product[] {
    const q = this.query().toLowerCase().trim();
    if (q.length < 2) return [];
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      this.getOccasionTags(p).some(o => o.toLowerCase().includes(q)) ||
      this.getColorTags(p).some(c => c.toLowerCase().includes(q))
    ).slice(0, 6);
  }

  filterProducts(products: Product[]): Product[] {
    let result = products;
    const q = this.query().toLowerCase().trim();

    if (q) {
      result = result.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        this.getOccasionTags(p).some(o => o.toLowerCase().includes(q)) ||
        this.getColorTags(p).some(c => c.toLowerCase().includes(q))
      );
    }

    if (this.selectedOccasion()) {
      result = result.filter(p => this.getOccasionTags(p).includes(this.selectedOccasion()));
    }

    if (this.selectedColor()) {
      result = result.filter(p => this.getColorTags(p).includes(this.selectedColor()));
    }

    switch (this.priceRange()) {
      case 'budget':  result = result.filter(p => p.price < 35);          break;
      case 'mid':     result = result.filter(p => p.price >= 35 && p.price <= 70); break;
      case 'premium': result = result.filter(p => p.price > 70);          break;
    }

    return result;
  }

  hasActiveFilters(): boolean {
    return !!(this.query() || this.selectedOccasion() || this.selectedColor() || this.priceRange() !== 'all');
  }

  clearAll(): void {
    this.query.set('');
    this.selectedOccasion.set('');
    this.selectedColor.set('');
    this.priceRange.set('all');
  }

  toggleOccasion(o: string): void {
    this.selectedOccasion.set(this.selectedOccasion() === o ? '' : o);
  }

  toggleColor(c: string): void {
    this.selectedColor.set(this.selectedColor() === c ? '' : c);
  }

  togglePriceRange(r: 'budget' | 'mid' | 'premium'): void {
    this.priceRange.set(this.priceRange() === r ? 'all' : r);
  }
}
