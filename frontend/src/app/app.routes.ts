import { Routes } from '@angular/router';
import { Home } from './components/home/home';
import { ProductDetail } from './components/product-detail/product-detail';
import { Cart } from './components/cart/cart';
import { Checkout } from './components/checkout/checkout';
import { Contact } from './components/contact/contact';
import { Signin } from './components/signin/signin';
import { Orders } from './components/orders/orders';
import { OrderDetail } from './components/order-detail/order-detail';
import { BouquetBuilder } from './components/bouquet-builder/bouquet-builder';
import { Wishlist } from './components/wishlist/wishlist';
import { OccasionPage } from './components/occasion-page/occasion-page';
import { Subscription } from './components/subscription/subscription';
import { MySubscriptions } from './components/my-subscriptions/my-subscriptions';
import { CorporatePortal } from './components/corporate-portal/corporate-portal';
import { CorporateOrder } from './components/corporate-order/corporate-order';
import { MyCorporate } from './components/my-corporate/my-corporate';
import { MyLoyalty } from './components/my-loyalty/my-loyalty';
import { Admin } from './components/admin/admin';
import { VerifyEmail } from './components/verify-email/verify-email';
import { ResetPassword } from './components/reset-password/reset-password';
import { Reminders } from './components/reminders/reminders';
import { TrackOrder } from './components/track-order/track-order';
import { ForgotPassword } from './components/forgot-password/forgot-password';
import { Account } from './components/account/account';
import { AccountProfile } from './components/account-profile/account-profile';
import { AccountPassword } from './components/account-password/account-password';
import { AccountEmail } from './components/account-email/account-email';
import { ConfirmEmail } from './components/confirm-email/confirm-email';
import { BecomeSeller } from './components/become-seller/become-seller';
import { MerchantDashboard } from './components/merchant-dashboard/merchant-dashboard';
import { authGuard } from './guards/auth-guard';
import { merchantGuard } from './guards/merchant-guard';

export const routes: Routes = [
  // ── Public routes ──────────────────────────────────────────────────────────
  { path: '', component: Home },
  { path: 'products/:id', component: ProductDetail },
  { path: 'contact', component: Contact },
  { path: 'signin', component: Signin },
  { path: 'verify-email', component: VerifyEmail },
  { path: 'reset-password', component: ResetPassword },
  { path: 'forgot-password', component: ForgotPassword },
  { path: 'confirm-email', component: ConfirmEmail },
  { path: 'builder', component: BouquetBuilder },
  { path: 'occasions', component: OccasionPage },
  { path: 'occasions/:slug', component: OccasionPage },
  { path: 'petal-studio', component: CorporatePortal },
  { path: 'track', component: TrackOrder },
  { path: 'become-seller', component: BecomeSeller, canActivate: [authGuard] },

  // ── Legacy redirects (Corporate Suite → Petal Studio) ──────────────────────
  { path: 'corporate', redirectTo: 'petal-studio', pathMatch: 'full' },
  { path: 'corporate-order', redirectTo: 'petal-studio/book', pathMatch: 'full' },
  { path: 'my-corporate', redirectTo: 'my-studio', pathMatch: 'full' },

  // ── Guest-accessible routes ────────────────────────────────────────────────
  { path: 'cart', component: Cart },
  { path: 'checkout', component: Checkout },
  { path: 'wishlist', component: Wishlist },

  // ── Login-required routes ──────────────────────────────────────────────────
  { path: 'account', component: Account, canActivate: [authGuard] },
  { path: 'account/profile', component: AccountProfile, canActivate: [authGuard] },
  { path: 'account/password', component: AccountPassword, canActivate: [authGuard] },
  { path: 'account/email', component: AccountEmail, canActivate: [authGuard] },
  { path: 'orders', component: Orders, canActivate: [authGuard] },
  { path: 'orders/:id', component: OrderDetail, canActivate: [authGuard] },
  { path: 'subscribe', component: Subscription, canActivate: [authGuard] },
  { path: 'my-subscriptions', component: MySubscriptions, canActivate: [authGuard] },
  { path: 'petal-studio/book', component: CorporateOrder, canActivate: [authGuard] },
  { path: 'my-studio', component: MyCorporate, canActivate: [authGuard] },
  { path: 'my-loyalty', component: MyLoyalty, canActivate: [authGuard] },
  { path: 'reminders', component: Reminders, canActivate: [authGuard] },
  { path: 'admin', component: Admin, canActivate: [authGuard] },
  { path: 'merchant', component: MerchantDashboard, canActivate: [merchantGuard] },

  { path: '**', redirectTo: '' }
];
