import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ActiveConfirm extends Required<Omit<ConfirmOptions, 'danger'>> {
  danger: boolean;
  resolve: (result: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly active = signal<ActiveConfirm | null>(null);

  /** Show a confirm dialog. Resolves true if confirmed, false if cancelled. */
  ask(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      this.active.set({
        title: options.title ?? 'Are you sure?',
        message: options.message,
        confirmText: options.confirmText ?? 'Confirm',
        cancelText: options.cancelText ?? 'Cancel',
        danger: options.danger ?? false,
        resolve,
      });
    });
  }

  private settle(result: boolean): void {
    const a = this.active();
    if (a) {
      this.active.set(null);
      a.resolve(result);
    }
  }

  confirm(): void { this.settle(true); }
  cancel(): void { this.settle(false); }
}
