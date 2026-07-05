import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';
import { ToastService } from '../services/toast';

/**
 * Blocks routes that need a signed-in user. If not logged in, it redirects to
 * /signin with a returnUrl so the user comes back to where they intended after login.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isLoggedIn()) return true;

  inject(ToastService).show('Please sign in to continue', 'error');
  return router.createUrlTree(['/signin'], { queryParams: { returnUrl: state.url } });
};
