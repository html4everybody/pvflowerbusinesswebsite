import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-contact',
  imports: [FormsModule],
  templateUrl: './contact.html',
  styleUrl: './contact.scss'
})
export class Contact {
  formData = {
    name: '',
    email: '',
    phone: '',
    subject: '',
    message: ''
  };

  messageSent = signal(false);
  loading = signal(false);
  errorMessage = signal('');

  constructor(private http: HttpClient) {}

  submitForm(): void {
    this.loading.set(true);
    this.errorMessage.set('');

    this.http.post(`${environment.apiUrl}/api/contact`, this.formData).subscribe({
      next: () => {
        this.loading.set(false);
        this.messageSent.set(true);
        this.formData = { name: '', email: '', phone: '', subject: '', message: '' };
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set('Something went wrong. Please try again.');
      }
    });
  }
}
