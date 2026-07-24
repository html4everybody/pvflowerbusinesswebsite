import { Component, OnInit, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NoticeService } from '../../services/notice';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-account-nav',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './account-nav.html',
  styleUrl: './account-nav.scss',
})
export class AccountNav implements OnInit {
  noticeService = inject(NoticeService);
  authService = inject(AuthService);

  ngOnInit(): void {
    this.noticeService.load();
  }
}
