import { Component, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NoticeService, UserNotice } from '../../services/notice';

@Component({
  selector: 'app-notifications',
  imports: [RouterLink],
  templateUrl: './notifications.html',
  styleUrl: './notifications.scss',
})
export class Notifications implements OnInit {
  constructor(public noticeService: NoticeService, private router: Router) {}

  ngOnInit(): void {
    this.noticeService.load();
    this.noticeService.markAllRead();
  }

  goToNotice(n: UserNotice): void {
    const route = this.noticeService.noticeRoute(n);
    if (route) this.router.navigate(route);
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
}
