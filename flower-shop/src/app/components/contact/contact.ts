import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

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

  messageSent = false;

  submitForm(): void {
    this.messageSent = true;
    this.formData = {
      name: '',
      email: '',
      phone: '',
      subject: '',
      message: ''
    };
  }
}
