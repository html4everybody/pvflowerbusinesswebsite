import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CartService } from '../../services/cart';
import { SearchService } from '../../services/search';
import { AuthService } from '../../services/auth';

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

  constructor(
    public cartService: CartService,
    public searchService: SearchService,
    public authService: AuthService
  ) {}

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
      this.searchService.query.set('');
    }
  }

  toggleUserMenu(): void {
    this.userMenuOpen = !this.userMenuOpen;
  }

  logout(): void {
    this.authService.logout();
    window.location.href = '/';
  }
}
