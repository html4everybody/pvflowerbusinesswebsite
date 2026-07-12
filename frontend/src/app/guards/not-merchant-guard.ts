import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';
import { ToastService } from '../services/toast';

/**
 * Blocks shopping routes (cart / checkout / wishlist) for merchant accounts —
 * merchants are sellers, not buyers. They can still browse the storefront.
 */
export const notMerchantGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isMerchant()) {
    inject(ToastService).show('Merchant accounts are for selling, not shopping', 'error');
    return router.createUrlTree(['/merchant']);
  }
  return true;
};
