import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-account-nav',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './account-nav.html',
  styleUrl: './account-nav.scss',
})
export class AccountNav {}
