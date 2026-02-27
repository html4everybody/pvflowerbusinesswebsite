import { Component, OnInit } from '@angular/core';
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
export class App implements OnInit {
  title = 'FloranFlowers';

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
  }
}
