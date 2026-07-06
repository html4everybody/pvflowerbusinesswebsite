import { Component, ElementRef, HostListener, OnInit, ViewChild, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { CartService } from '../../services/cart';
import { SearchService } from '../../services/search';
import { AuthService } from '../../services/auth';
import { ThemeService } from '../../services/theme';
import { ProductService } from '../../services/product';
import { WishlistService } from '../../services/wishlist';
import { NoticeService } from '../../services/notice';
import { Product } from '../../models/product.model';

@Component({
  selector: 'app-header',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './header.html',
  styleUrl: './header.scss'
})
export class Header implements OnInit {
  menuOpen = false;
  searchOpen = false;
  userMenuOpen = false;
  navStackOpen = false;
  notifOpen = false;
  isScrolled = false;
  showSuggestions = false;

  @ViewChild('searchInput') searchInputRef?: ElementRef<HTMLInputElement>;

  // ── Premium search: recent, trending, popular, keyboard nav ────────────────
  private readonly RECENT_KEY = 'viva_recent_searches';
  recentSearches = signal<string[]>(this.loadRecent());
  readonly trendingSearches = ['Roses', 'Lily', 'Sunflower', 'Orchid', 'Tulip', 'Peony', 'Carnation', 'Hydrangea'];
  highlightIndex = -1;

  private loadRecent(): string[] {
    try { return JSON.parse(localStorage.getItem(this.RECENT_KEY) ?? '[]'); } catch { return []; }
  }
  private addRecent(term: string): void {
    const t = (term || '').trim();
    if (t.length < 2) return;
    const list = [t, ...this.recentSearches().filter(x => x.toLowerCase() !== t.toLowerCase())].slice(0, 6);
    this.recentSearches.set(list);
    localStorage.setItem(this.RECENT_KEY, JSON.stringify(list));
  }
  clearRecent(): void {
    this.recentSearches.set([]);
    localStorage.removeItem(this.RECENT_KEY);
  }

  /** Apply a recent/trending term and run the search. */
  applyTerm(term: string): void {
    this.searchService.query.set(term);
    this.addRecent(term);
    this.closeSearch();
    this.goToCollection();
  }

  onSearchKeydown(event: KeyboardEvent): void {
    const list = this.suggestions;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.highlightIndex = Math.min(this.highlightIndex + 1, list.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.highlightIndex = Math.max(this.highlightIndex - 1, -1);
    } else if (event.key === 'Enter') {
      if (this.highlightIndex >= 0 && list[this.highlightIndex]) {
        this.selectSuggestion(list[this.highlightIndex]);
      } else {
        this.performSearch();
      }
    } else if (event.key === 'Escape') {
      this.closeSearch();
    }
  }

  @HostListener('window:scroll')
  onScroll(): void {
    this.isScrolled = window.scrollY > 20;
    this.menuOpen = false;
    // Do NOT close the search here — it's a full overlay with its own scroll.
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as Node;
    const headerEl = this.el.nativeElement;

    // Clicked outside header entirely — close the dropdowns (search is a full
    // overlay that manages its own open/close via the backdrop + Esc).
    if (!headerEl.contains(target)) {
      this.userMenuOpen = false;
      this.navStackOpen = false;
      this.menuOpen = false;
      this.closeNotif();
      return;
    }

    // Close the notifications dropdown unless the click was inside it
    const notif = headerEl.querySelector('.notif-wrapper');
    if (!notif?.contains(target)) this.closeNotif();

    // Inside header — close menu unless click was inside nav or on hamburger
    const nav = headerEl.querySelector('.nav');
    const hamburger = headerEl.querySelector('.hamburger');
    if (!nav?.contains(target) && !hamburger?.contains(target)) {
      this.menuOpen = false;
    }

    // Close user dropdown unless click was inside it
    const userMenu = headerEl.querySelector('.user-menu-wrapper');
    if (!userMenu?.contains(target)) {
      this.userMenuOpen = false;
    }

    // Close nav stack unless click was inside it
    const navStack = headerEl.querySelector('.nav-stack-wrapper');
    if (!navStack?.contains(target)) {
      this.navStackOpen = false;
    }
  }

  constructor(
    public cartService: CartService,
    public searchService: SearchService,
    public authService: AuthService,
    public themeService: ThemeService,
    public wishlistService: WishlistService,
    public noticeService: NoticeService,
    private productService: ProductService,
    private el: ElementRef,
    private router: Router
  ) {}

  ngOnInit(): void {
    if (this.authService.user()?.email) this.noticeService.load();
  }

  toggleNotif(): void {
    if (this.notifOpen) { this.closeNotif(); return; }
    this.notifOpen = true;
    this.userMenuOpen = false;
    this.navStackOpen = false;
    this.noticeService.load();
  }

  closeNotif(): void {
    if (!this.notifOpen) return;
    this.notifOpen = false;
    this.noticeService.markAllRead();   // seen → clear the badge
  }

  get suggestions(): Product[] {
    return this.searchService.getSuggestions(this.productService.getProducts());
  }

  onSearchInput(value: string): void {
    this.searchService.query.set(value);
    this.showSuggestions = value.trim().length >= 2;
    this.highlightIndex = -1;
  }

  selectSuggestion(product: Product): void {
    this.searchService.query.set(product.name);
    this.addRecent(product.name);
    this.closeSearch();
    this.goToCollection();
  }

  performSearch(): void {
    this.addRecent(this.searchService.query());
    this.closeSearch();
    this.goToCollection();
  }

  private goToCollection(): void {
    this.router.navigate(['/']).then(() => {
      setTimeout(() => {
        document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    });
  }

  goToHomeSection(sectionId: string): void {
    this.navStackOpen = false;
    this.menuOpen = false;
    // If we're already on the home page, scroll directly (avoids a router
    // round-trip that desyncs and makes repeat/alternate clicks flaky).
    // Otherwise navigate home with ?scrollTo= and let Home scroll on render.
    const onHome = this.router.url.split('?')[0].split('#')[0] === '/';
    if (onHome) {
      this.scrollToId(sectionId);
    } else {
      this.router.navigate(['/'], { queryParams: { scrollTo: sectionId } });
    }
  }

  private scrollToId(id: string, attempts = 0): void {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (attempts < 30) {
      setTimeout(() => this.scrollToId(id, attempts + 1), 100);
    }
  }

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
    if (this.menuOpen) {
      setTimeout(() => {
        const nav = this.el.nativeElement.querySelector('.nav');
        if (nav) nav.scrollTop = 0;
      });
    }
  }

  closeMenu(): void {
    this.menuOpen = false;
    this.userMenuOpen = false;
  }

  scrollToTop(): void {
    this.menuOpen = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  toggleSearch(): void {
    this.searchOpen ? this.closeSearch() : this.openSearch();
  }

  openSearch(): void {
    this.searchOpen = true;
    this.highlightIndex = -1;
    this.showSuggestions = this.searchService.query().trim().length >= 2;
    document.documentElement.style.overflow = 'hidden'; // lock body scroll behind the overlay
    setTimeout(() => this.searchInputRef?.nativeElement.focus(), 60);
  }

  closeSearch(): void {
    this.searchOpen = false;
    this.showSuggestions = false;
    this.highlightIndex = -1;
    document.documentElement.style.overflow = '';
  }

  // Category glyph + match highlighting for the text-based results
  categoryEmoji(cat: string): string {
    const map: Record<string, string> = { Flowers: '🌸', Bouquets: '💐', Garlands: '🌼', Gifts: '🎁', Decoration: '🪴' };
    return map[cat] || '🌷';
  }
  get quickCategories(): string[] { return this.productService.getCategories(); }

  /** Live count of products matching the current query + facets (for the Show-results button). */
  get facetResultCount(): number {
    return this.searchService.filterProducts(this.productService.getProducts()).length;
  }
  highlight(text: string): string {
    const q = this.searchService.query().trim();
    const safe = this.escapeHtml(text);
    if (!q) return safe;
    const eq = this.escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(`(${eq})`, 'ig'), '<strong>$1</strong>');
  }
  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  toggleUserMenu(): void {
    this.userMenuOpen = !this.userMenuOpen;
  }

  toggleNavStack(): void {
    this.navStackOpen = !this.navStackOpen;
  }

  get userInitials(): string {
    const user = this.authService.user();
    if (!user) return '';
    const f = user.firstName?.[0] ?? '';
    const l = user.lastName?.[0] ?? '';
    return (f + l).toUpperCase();
  }

  logout(): void {
    this.authService.logout();
    sessionStorage.setItem('viva_toast', 'Logged out successfully.');
    window.location.href = '/';
  }
}
