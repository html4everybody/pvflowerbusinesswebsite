import { Injectable, signal } from '@angular/core';
import { Product } from '../models/product.model';

export type PriceRange = 'all' | 'budget' | 'mid' | 'premium';

@Injectable({ providedIn: 'root' })
export class SearchService {
  readonly query = signal('');
  readonly selectedCategory = signal('');
  readonly selectedOccasion = signal('');
  readonly selectedColor = signal('');
  readonly priceRange = signal<PriceRange>('all');

  readonly occasions = [
    'Birthday', 'Anniversary', 'Wedding', 'Romance', 'Sympathy',
    'Get Well', 'New Baby', 'Mothers Day', 'Congratulations'
  ];

  readonly colors = [
    { name: 'Red',      hex: '#e53e3e' },
    { name: 'Pink',     hex: '#ed64a6' },
    { name: 'White',    hex: '#f2f2f2' },
    { name: 'Yellow',   hex: '#ecc94b' },
    { name: 'Orange',   hex: '#dd6b20' },
    { name: 'Peach',    hex: '#fbaf85' },
    { name: 'Coral',    hex: '#fc8181' },
    { name: 'Purple',   hex: '#805ad5' },
    { name: 'Lavender', hex: '#b794f4' },
    { name: 'Blue',     hex: '#3182ce' },
    { name: 'Green',    hex: '#38a169' },
    { name: 'Burgundy', hex: '#822727' },
    { name: 'Mixed',    hex: 'conic-gradient(#e53e3e 0deg, #ed64a6 60deg, #ecc94b 120deg, #48bb78 180deg, #3182ce 240deg, #805ad5 300deg, #e53e3e 360deg)' },
  ];

  readonly priceLabels: Record<string, string> = {
    budget:  'Under ₹35',
    mid:     '₹35 – ₹70',
    premium: '₹70 & above',
  };

  // ── Derived tags from product text ─────────────────────────────────────────

  private getOccasionTags(p: Product): string[] {
    const text = (p.name + ' ' + p.description).toLowerCase();
    const tags = new Set<string>();

    // 1) Explicit text signals
    if (/birthday|celebrat|festiv/.test(text))                                 tags.add('Birthday');
    if (/wedding|bridal|bridesmaid|bride|groom|corsage|boutonniere|crown|garland/.test(text)) tags.add('Wedding');
    if (/anniversary/.test(text))                                              tags.add('Anniversary');
    if (/sympathy|condol|memorial|funeral|peace/.test(text))                   tags.add('Sympathy');
    if (/romance|romantic|love|valentine/.test(text))                          tags.add('Romance');
    if (/congratulat|achievem|graduat/.test(text))                             tags.add('Congratulations');
    if (/get well|recovery|wishes|cheer/.test(text))                           tags.add('Get Well');
    if (/baby|newborn/.test(text))                                             tags.add('New Baby');
    if (/mother|mom/.test(text))                                               tags.add('Mothers Day');

    // 2) Category / flower-type inference so sensible combos return results
    if (p.category === 'Garlands')                          tags.add('Wedding');   // garlands are ceremony staples
    if (p.category === 'Bouquets')                          tags.add('Birthday');
    if (/\brose\b|peony|peonies|tulip|orchid/.test(text))   { tags.add('Romance'); tags.add('Anniversary'); }
    if (/lily|lilies|chrysanthemum/.test(text))             tags.add('Sympathy');
    if (/sunflower|daisy|gerbera|cheerful|bright/.test(text)) tags.add('Get Well');

    return [...tags];
  }

  private getColorTags(p: Product): string[] {
    const name = p.name.toLowerCase();
    const tags: string[] = [];
    if (/\bred\b|crimson|scarlet/.test(name))                     tags.push('Red');
    if (/\bpink\b|blush|magenta/.test(name))                      tags.push('Pink');
    if (/white|pure|ivory|snow|bridal/.test(name))                tags.push('White');
    if (/yellow|gold|sunshine|sunny/.test(name))                  tags.push('Yellow');
    if (/orange|amber|marigold/.test(name))                       tags.push('Orange');
    if (/peach/.test(name))                                       tags.push('Peach');
    if (/coral/.test(name))                                       tags.push('Coral');
    if (/purple|violet|royal|iris/.test(name))                    tags.push('Purple');
    if (/lavender/.test(name))                                    tags.push('Lavender');
    if (/\bblue\b|delphinium|hydrangea/.test(name))               tags.push('Blue');
    if (/green|eucalyptus|fern|olive|succulent|leaf/.test(name))  tags.push('Green');
    if (/burgundy|wine|maroon/.test(name))                        tags.push('Burgundy');
    if (/mixed|rainbow|assorted|tropical|exotic|colorful|wildflower/.test(name)) tags.push('Mixed');
    return tags;
  }

  // ── Relevance scoring (name-first, no loose description matches) ─────────────

  private matchScore(p: Product, q: string): number {
    const name = p.name.toLowerCase();
    if (name === q) return 100;
    if (name.startsWith(q)) return 90;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp('\\b' + escaped).test(name)) return 80;   // matches start of any word
    if (name.includes(q)) return 68;
    if (p.category.toLowerCase().includes(q)) return 55;
    if (this.getColorTags(p).some(c => c.toLowerCase().includes(q))) return 50;
    if (this.getOccasionTags(p).some(o => o.toLowerCase().includes(q))) return 45;
    return 0; // deliberately NOT matching description — keeps results relevant
  }

  private rank(products: Product[], q: string): Product[] {
    return products
      .map(p => ({ p, s: this.matchScore(p, q) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name))
      .map(x => x.p);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getSuggestions(products: Product[]): Product[] {
    const q = this.query().toLowerCase().trim();
    if (q.length < 2) return [];
    return this.rank(products, q).slice(0, 7);
  }

  filterProducts(products: Product[]): Product[] {
    let result = products;
    const q = this.query().toLowerCase().trim();

    if (q) result = this.rank(result, q);
    if (this.selectedCategory()) result = result.filter(p => p.category === this.selectedCategory());
    if (this.selectedOccasion()) result = result.filter(p => this.getOccasionTags(p).includes(this.selectedOccasion()));
    if (this.selectedColor())    result = result.filter(p => this.getColorTags(p).includes(this.selectedColor()));

    switch (this.priceRange()) {
      case 'budget':  result = result.filter(p => p.price < 35);                 break;
      case 'mid':     result = result.filter(p => p.price >= 35 && p.price <= 70); break;
      case 'premium': result = result.filter(p => p.price > 70);                 break;
    }
    return result;
  }

  hasActiveFilters(): boolean {
    return !!(this.query() || this.selectedCategory() || this.selectedOccasion() ||
              this.selectedColor() || this.priceRange() !== 'all');
  }

  clearAll(): void {
    this.query.set('');
    this.selectedCategory.set('');
    this.selectedOccasion.set('');
    this.selectedColor.set('');
    this.priceRange.set('all');
  }

  toggleColor(c: string): void { this.selectedColor.set(this.selectedColor() === c ? '' : c); }
  togglePriceRange(r: 'budget' | 'mid' | 'premium'): void { this.priceRange.set(this.priceRange() === r ? 'all' : r); }
  toggleOccasion(o: string): void { this.selectedOccasion.set(this.selectedOccasion() === o ? '' : o); }
}
