import { ApplicationConfig, APP_INITIALIZER, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withViewTransitions, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

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
    }
  ]
};
