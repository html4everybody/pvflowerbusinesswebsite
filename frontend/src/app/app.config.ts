import { ApplicationConfig, APP_INITIALIZER, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withViewTransitions, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { ProductService } from './services/product';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // scroll-to-top handled manually in app.ts (NavigationEnd) so it can be
    // skipped for ?scrollTo= navigations (Live Deals / Bundle Offers).
    provideRouter(routes, withViewTransitions(), withInMemoryScrolling({ scrollPositionRestoration: 'disabled' })),
    provideHttpClient(),
    {
      provide: APP_INITIALIZER,
      useFactory: (productService: ProductService) => () => productService.loadProducts(),
      deps: [ProductService],
      multi: true
    },
    // PWA installability. registerWhenStable so it never competes with the
    // initial page load; disabled in dev so `ng serve` iteration is never
    // stuck behind a stale cached bundle.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    })
  ]
};
