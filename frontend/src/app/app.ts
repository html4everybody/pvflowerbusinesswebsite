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
  styleUrl: './app.scss'
})
export class App implements OnInit, OnDestroy {
  title = 'VivaPetals';
  showFooter = signal(true);
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly NO_FOOTER_ROUTES = ['/signin', '/verify-email', '/forgot-password', '/reset-password'];

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
        this.showFooter.set(!this.NO_FOOTER_ROUTES.some(r => event.urlAfterRedirects.startsWith(r)));
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
