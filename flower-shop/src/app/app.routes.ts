import { Routes } from '@angular/router';
import { Home } from './components/home/home';
import { ProductDetail } from './components/product-detail/product-detail';
import { Cart } from './components/cart/cart';
import { Checkout } from './components/checkout/checkout';
import { Contact } from './components/contact/contact';
import { Signin } from './components/signin/signin';
import { Orders } from './components/orders/orders';

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'products/:id', component: ProductDetail },
  { path: 'cart', component: Cart },
  { path: 'checkout', component: Checkout },
  { path: 'contact', component: Contact },
  { path: 'signin', component: Signin },
  { path: 'orders', component: Orders },
  { path: '**', redirectTo: '' }
];
