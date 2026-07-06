import { Component, OnInit, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NoticeService } from '../../services/notice';

@Component({
  selector: 'app-account-nav',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './account-nav.html',
  styleUrl: './account-nav.scss',
})
export class AccountNav implements OnInit {
  noticeService = inject(NoticeService);

  ngOnInit(): void {
    this.noticeService.load();
  }
}
