import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';
import { ToastService } from '../services/toast';

/**
 * Blocks routes that need an APPROVED merchant. Non-merchants are sent to the
 * "Become a Seller" page; signed-out users go to sign-in with a returnUrl.
 */
export const merchantGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    inject(ToastService).show('Please sign in to continue', 'error');
    return router.createUrlTree(['/signin'], { queryParams: { returnUrl: state.url } });
  }
  if (auth.isMerchant()) return true;

  inject(ToastService).show('Merchant access required', 'error');
  return router.createUrlTree(['/become-seller']);
};
