import { Component, ElementRef, HostListener } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
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

  @HostListener('window:scroll')
  onScroll(): void {
    this.isScrolled = window.scrollY > 20;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.el.nativeElement.contains(event.target)) {
      this.showSuggestions = false;
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
    private el: ElementRef
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
