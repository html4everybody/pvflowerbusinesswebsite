import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { Router, NavigationEnd, RouterOutlet } from '@angular/router';
import { Header } from './components/header/header';
import { Footer } from './components/footer/footer';
import { Toast } from './components/toast/toast';
import { ToastService } from './services/toast';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Header, Footer, Toast],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: { '[class.no-chrome]': '!showHeader()' }
})
export class App implements OnInit, OnDestroy {
  title = 'VivaPetals';
  showHeader = signal(true);
  showFooter = signal(true);
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly NO_CHROME_ROUTES = ['/signin', '/verify-email', '/forgot-password', '/reset-password', '/confirm-email'];

  constructor(private router: Router, private toastService: ToastService) {}

  ngOnInit(): void {
    const pendingToast = sessionStorage.getItem('viva_toast');
    if (pendingToast) {
      sessionStorage.removeItem('viva_toast');
      setTimeout(() => this.toastService.show(pendingToast), 300);
    }

    this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        const hideChrome = this.NO_CHROME_ROUTES.some(r => event.urlAfterRedirects.startsWith(r));
        this.showHeader.set(!hideChrome);
        this.showFooter.set(!hideChrome);
      }
    });

    window.addEventListener('scroll', this.onScroll, { passive: true });
  }

  ngOnDestroy(): void {
    window.removeEventListener('scroll', this.onScroll);
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
  }

  private onScroll = (): void => {
    document.documentElement.classList.add('is-scrolling');
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(() => {
      document.documentElement.classList.remove('is-scrolling');
    }, 800);
  };
}
