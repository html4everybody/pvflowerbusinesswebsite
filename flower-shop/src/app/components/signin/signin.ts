import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-signin',
  imports: [FormsModule],
  templateUrl: './signin.html',
  styleUrl: './signin.scss'
})
export class Signin {
  isSignUp = signal(false);
  errorMessage = signal('');
  successMessage = signal('');
  loading = signal(false);

  loginData = { email: '', password: '' };
  signupData = { firstName: '', lastName: '', email: '', password: '', confirmPassword: '' };

  constructor(private authService: AuthService, private router: Router) {}

  toggleMode(): void {
    this.isSignUp.set(!this.isSignUp());
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  onLogin(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.loading.set(true);

    this.authService.login(this.loginData.email, this.loginData.password).subscribe({
      next: () => {
        this.loading.set(false);
        this.router.navigate(['/']);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(err.error?.detail || 'Invalid email or password');
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
      lastName: this.signupData.lastName,
      email: this.signupData.email,
      password: this.signupData.password
    }).subscribe({
      next: () => {
        this.loading.set(false);
        this.isSignUp.set(false);
        this.loginData.email = this.signupData.email;
        this.loginData.password = '';
        this.successMessage.set(`Account created! Welcome, ${this.signupData.firstName}. Please sign in.`);
        this.signupData = { firstName: '', lastName: '', email: '', password: '', confirmPassword: '' };
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(err.error?.detail || 'Registration failed. Please try again.');
      }
    });
  }
}
