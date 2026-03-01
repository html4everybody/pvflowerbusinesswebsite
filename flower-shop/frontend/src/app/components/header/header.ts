import { Component, ElementRef, HostListener, ViewChild } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { CartService } from '../../services/cart';
import { SearchService } from '../../services/search';
import { AuthService } from '../../services/auth';
import { ThemeService } from '../../services/theme';
import { ProductService } from '../../services/product';
import { WishlistService } from '../../services/wishlist';
import { Product } from '../../models/product.model';

@Component({
  selector: 'app-header',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './header.html',
  styleUrl: './header.scss'
})
export class Header {
  menuOpen = false;
  searchOpen = false;
  userMenuOpen = false;
  isScrolled = false;
  showSuggestions = false;

  @ViewChild('searchInput') searchInputRef?: ElementRef<HTMLInputElement>;

  @HostListener('window:scroll')
  onScroll(): void {
    this.isScrolled = window.scrollY > 20;
    this.menuOpen = false;
    this.searchOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as Node;
    const headerEl = this.el.nativeElement;

    // Clicked outside header entirely — close everything
    if (!headerEl.contains(target)) {
      this.showSuggestions = false;
      this.userMenuOpen = false;
      this.menuOpen = false;
      this.searchOpen = false;
      return;
    }

    // Inside header — close menu unless click was inside nav or on hamburger
    const nav = headerEl.querySelector('.nav');
    const hamburger = headerEl.querySelector('.hamburger');
    if (!nav?.contains(target) && !hamburger?.contains(target)) {
      this.menuOpen = false;
    }

    // Inside header — close search unless click was inside search panel or on search button
    const searchPanel = headerEl.querySelector('.search-panel');
    const searchBtn = headerEl.querySelector('.search-icon-btn');
    if (!searchPanel?.contains(target) && !searchBtn?.contains(target)) {
      this.searchOpen = false;
      this.showSuggestions = false;
    }

    // Close user dropdown unless click was inside it
    const userMenu = headerEl.querySelector('.user-menu-wrapper');
    if (!userMenu?.contains(target)) {
      this.userMenuOpen = false;
    }
  }

  constructor(
    public cartService: CartService,
    public searchService: SearchService,
    public authService: AuthService,
    public themeService: ThemeService,
    public wishlistService: WishlistService,
    private productService: ProductService,
    private el: ElementRef,
    private router: Router
  ) {}

  get suggestions(): Product[] {
    return this.searchService.getSuggestions(this.productService.getProducts());
  }

  onSearchInput(value: string): void {
    this.searchService.query.set(value);
    this.showSuggestions = value.trim().length >= 2;
  }

  selectSuggestion(product: Product): void {
    this.searchService.query.set(product.name);
    this.showSuggestions = false;
    this.searchOpen = false;
    this.goToCollection();
  }

  performSearch(): void {
    this.showSuggestions = false;
    this.searchOpen = false;
    this.goToCollection();
  }

  private goToCollection(): void {
    this.router.navigate(['/']).then(() => {
      setTimeout(() => {
        document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    });
  }

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
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
    this.searchOpen = !this.searchOpen;
    if (!this.searchOpen) {
      this.searchService.clearAll();
      this.showSuggestions = false;
    } else {
      this.searchInputRef?.nativeElement.focus();
    }
  }

  toggleUserMenu(): void {
    this.userMenuOpen = !this.userMenuOpen;
  }

  logout(): void {
    this.authService.logout();
    sessionStorage.setItem('floran_toast', 'Logged out successfully.');
    window.location.href = '/';
  }
}
