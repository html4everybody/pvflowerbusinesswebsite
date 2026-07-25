import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';
import { ToastService } from '../services/toast';

/**
 * Blocks routes that need an APPROVED merchant. Non-merchants are sent to the
 * "Become a Seller" page; signed-out users go to sign-in with a returnUrl.
 *
 * Awaits AuthService.sessionReady() first — see admin-guard.ts for why: the
 * cached user() on a fresh load reflects unverified localStorage state until
 * the server-verified /api/auth/me response lands.
 */
export const merchantGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.sessionReady();

  if (!auth.isLoggedIn()) {
    inject(ToastService).show('Please sign in to continue', 'error');
    return router.createUrlTree(['/signin'], { queryParams: { returnUrl: state.url } });
  }
  if (auth.isMerchant()) return true;

  inject(ToastService).show('Merchant access required', 'error');
  return router.createUrlTree(['/become-seller']);
};
