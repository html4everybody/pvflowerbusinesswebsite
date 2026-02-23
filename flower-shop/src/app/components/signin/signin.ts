import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-signin',
  imports: [RouterLink, FormsModule],
  templateUrl: './signin.html',
  styleUrl: './signin.scss'
})
export class Signin {
  isSignUp = false;

  loginData = {
    email: '',
    password: ''
  };

  signupData = {
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: ''
  };

  toggleMode(): void {
    this.isSignUp = !this.isSignUp;
  }

  onLogin(): void {
    console.log('Login:', this.loginData);
  }

  onSignup(): void {
    console.log('Signup:', this.signupData);
  }
}
