import { Component, HostListener } from '@angular/core';
import { ConfirmService } from '../../services/confirm';

@Component({
  selector: 'app-confirm-dialog',
  imports: [],
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.scss',
})
export class ConfirmDialog {
  constructor(public confirm: ConfirmService) {}

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.confirm.active()) this.confirm.cancel();
  }

  @HostListener('document:keydown.enter')
  onEnter(): void {
    if (this.confirm.active()) this.confirm.confirm();
  }
}
