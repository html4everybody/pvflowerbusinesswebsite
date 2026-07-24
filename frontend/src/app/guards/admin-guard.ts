import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';
import { ToastService } from '../services/toast';

/**
 * Blocks routes that need an admin. Mirrors merchant-guard.ts — the Admin
 * component previously did this same check itself inside ngOnInit, which
 * still worked but let the admin shell flash on screen for a tick before
 * redirecting non-admins away.
 */
export const adminGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    inject(ToastService).show('Please sign in to continue', 'error');
    return router.createUrlTree(['/signin'], { queryParams: { returnUrl: state.url } });
  }
  if (auth.isAdmin()) return true;

  inject(ToastService).show('Admin access required', 'error');
  return router.createUrlTree(['/']);
};
