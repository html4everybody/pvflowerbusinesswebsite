import { Component, signal, AfterViewInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth';
import { ToastService } from '../../services/toast';
import { environment } from '../../../environments/environment';

// Global SDK declarations
declare const google: any;
declare const FB: any;

@Component({
  selector: 'app-signin',
  imports: [FormsModule],
  templateUrl: './signin.html',
  styleUrl: './signin.scss'
})
export class Signin implements AfterViewInit {
  isSignUp        = signal(false);
  errorMessage    = signal('');
  successMessage  = signal('');
  loading         = signal(false);
  googleLoading   = signal(false);
  facebookLoading = signal(false);
  referralCode    = signal('');
  showResendLink     = signal(false);
  resendLoading      = signal(false);
  resendDone         = signal(false);
  showForgotPassword   = signal(false);
  showLoginPassword    = signal(false);
  showSignupPassword   = signal(false);
  showConfirmPassword  = signal(false);
  forgotEmail        = signal('');
  forgotLoading      = signal(false);
  forgotSent         = signal(false);
  forgotError        = signal('');

  loginData  = { email: '', password: '' };
  signupData = { firstName: '', lastName: '', email: '', password: '', confirmPassword: '' };

  constructor(
    private authService: AuthService,
    private router: Router,
    private toastService: ToastService,
    private route: ActivatedRoute,
    private http: HttpClient
  ) {
    const ref = this.route.snapshot.queryParams['ref'];
    if (ref) {
      this.referralCode.set(ref);
      this.isSignUp.set(true);
    }
  }

  ngAfterViewInit(): void {
    // Initialize Facebook SDK early so the popup opens faster on click
    try {
      if (typeof FB !== 'undefined' && environment.facebookAppId !== 'YOUR_FACEBOOK_APP_ID') {
        FB.init({ appId: environment.facebookAppId, cookie: true, xfbml: false, version: 'v19.0' });
      }
    } catch { /* SDK not loaded yet — handled in loginWithFacebook */ }
  }

  // ── Google Sign-In ──────────────────────────────────────────────────────────
  loginWithGoogle(): void {
    this.errorMessage.set('');

    if (environment.googleClientId === 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com') {
      this.errorMessage.set('Google sign-in is not configured yet.');
      return;
    }

    if (typeof google === 'undefined') {
      this.errorMessage.set('Google SDK failed to load. Please refresh the page.');
      return;
    }

    this.googleLoading.set(true);

    // Use OAuth2 token client — opens the real Google account picker popup
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: environment.googleClientId,
      scope: 'email profile openid',
      callback: (tokenResponse: any) => {
        if (tokenResponse.error) {
          this.googleLoading.set(false);
          this.errorMessage.set('Google sign-in failed. Please try again.');
          return;
        }
        this.handleSocialCallback('google', tokenResponse.access_token);
      },
      error_callback: (err: any) => {
        this.googleLoading.set(false);
        // 'popup_closed' means user cancelled — no error shown
        if (err?.type !== 'popup_closed') {
          this.errorMessage.set('Google sign-in was blocked. Please allow popups for this site.');
        }
      }
    });

    tokenClient.requestAccessToken({ prompt: 'select_account' });
  }

  // ── Facebook Sign-In ────────────────────────────────────────────────────────
  loginWithFacebook(): void {
    this.errorMessage.set('');

    if (environment.facebookAppId === 'YOUR_FACEBOOK_APP_ID') {
      this.errorMessage.set('Facebook sign-in is not configured yet. Please add FACEBOOK_APP_ID to environment.ts.');
      return;
    }

    if (typeof FB === 'undefined') {
      this.errorMessage.set('Facebook SDK failed to load. Please check your internet connection and refresh.');
      return;
    }

    this.facebookLoading.set(true);

    // Ensure FB is initialized
    FB.init({
      appId:   environment.facebookAppId,
      cookie:  true,
      xfbml:   false,
      version: 'v19.0'
    });

    FB.login((response: any) => {
      if (response.status === 'connected' && response.authResponse) {
        this.handleSocialCallback('facebook', response.authResponse.accessToken);
      } else {
        this.facebookLoading.set(false);
        if (response.status !== 'unknown') {
          this.errorMessage.set('Facebook sign-in was cancelled.');
        }
      }
    }, { scope: 'public_profile,email', return_scopes: true });
  }

  // ── Shared OAuth callback → backend → session ───────────────────────────────
  private handleSocialCallback(provider: string, token: string): void {
    this.http.post<any>(`${environment.apiUrl}/api/auth/social`, { provider, token }).subscribe({
      next: (res) => {
        this.googleLoading.set(false);
        this.facebookLoading.set(false);
        localStorage.setItem('viva_token', res.token);
        localStorage.setItem('viva_user', JSON.stringify(res.user));
        this.authService.user.set(res.user);
        this.toastService.show(`Welcome${res.user.firstName ? ', ' + res.user.firstName : ''}! 🌸`);
        this.router.navigate(['/']);
      },
      error: (err) => {
        this.googleLoading.set(false);
        this.facebookLoading.set(false);
        const providerName = provider === 'google' ? 'Google' : 'Facebook';
        this.errorMessage.set(err.error?.detail || `${providerName} sign-in failed. Please try again.`);
      }
    });
  }

  // ── Existing methods ────────────────────────────────────────────────────────
  toggleMode(): void {
    this.isSignUp.set(!this.isSignUp());
    this.errorMessage.set('');
    this.successMessage.set('');
    this.showResendLink.set(false);
    this.resendDone.set(false);
  }

  sendForgotPassword(): void {
    this.forgotError.set('');
    this.forgotSent.set(false);
    this.forgotLoading.set(true);
    this.http.post(`${environment.apiUrl}/api/auth/forgot-password`, { email: this.forgotEmail() }).subscribe({
      next: () => { this.forgotLoading.set(false); this.forgotSent.set(true); },
      error: (err) => { this.forgotLoading.set(false); this.forgotError.set(err.error?.detail || 'Something went wrong. Please try again.'); }
    });
  }

  resendVerification(): void {
    this.resendLoading.set(true);
    this.http.post(`${environment.apiUrl}/api/auth/resend-verification`, { email: this.loginData.email }).subscribe({
      next: () => { this.resendLoading.set(false); this.resendDone.set(true); },
      error: () => { this.resendLoading.set(false); this.resendDone.set(true); }
    });
  }

  onLogin(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.loading.set(true);

    this.authService.login(this.loginData.email, this.loginData.password).subscribe({
      next: () => {
        this.loading.set(false);
        const user = this.authService.user();
        this.toastService.show(`Hi ${user.firstName}, signed in successfully!`);
        this.router.navigate(['/']);
      },
      error: (err) => {
        this.loading.set(false);
        const msg = err.error?.detail || 'Invalid email or password';
        this.errorMessage.set(msg);
        this.showResendLink.set(err.status === 403);
      }
    });
  }

  onSignup(): void {
    this.errorMessage.set('');
    this.successMessage.set('');

    if (this.signupData.password !== this.signupData.confirmPassword) {
      this.errorMessage.set('Passwords do not match');
      return;
    }

    this.loading.set(true);

    this.authService.register({
      firstName: this.signupData.firstName,
      lastName:  this.signupData.lastName,
      email:     this.signupData.email,
      password:  this.signupData.password,
      referral_code: this.referralCode() || undefined
    }).subscribe({
      next: () => {
        this.loading.set(false);
        this.isSignUp.set(false);
        this.loginData.email    = this.signupData.email;
        this.loginData.password = '';
        this.successMessage.set(`We've sent a verification email to ${this.signupData.email}. Please verify before signing in.`);
        this.signupData = { firstName: '', lastName: '', email: '', password: '', confirmPassword: '' };
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(err.error?.detail || 'Registration failed. Please try again.');
      }
    });
  }
}
