import { Component, OnInit, OnDestroy } from '@angular/core';
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
  title = 'FloranFlowers';
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private router: Router, private toastService: ToastService) {}

  ngOnInit(): void {
    const pendingToast = sessionStorage.getItem('floran_toast');
    if (pendingToast) {
      sessionStorage.removeItem('floran_toast');
      setTimeout(() => this.toastService.show(pendingToast), 300);
    }

    this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
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
