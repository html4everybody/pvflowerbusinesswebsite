import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  /** If set, shows a reason textarea; the entered text is returned by askReason(). */
  promptLabel?: string;
  promptPlaceholder?: string;
}

interface ActiveConfirm {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  danger: boolean;
  promptLabel: string | null;
  promptPlaceholder: string;
  resolve: (result: { ok: boolean; reason: string }) => void;
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly active = signal<ActiveConfirm | null>(null);
  readonly reasonInput = signal('');

  /** Simple confirm. Resolves true if confirmed. */
  ask(options: ConfirmOptions): Promise<boolean> {
    return this.open(options).then(r => r.ok);
  }

  /** Confirm with a reason textarea. Resolves { ok, reason }. */
  askReason(options: ConfirmOptions): Promise<{ ok: boolean; reason: string }> {
    return this.open(options);
  }

  private open(options: ConfirmOptions): Promise<{ ok: boolean; reason: string }> {
    this.reasonInput.set('');
    return new Promise(resolve => {
      this.active.set({
        title: options.title ?? 'Are you sure?',
        message: options.message,
        confirmText: options.confirmText ?? 'Confirm',
        cancelText: options.cancelText ?? 'Cancel',
        danger: options.danger ?? false,
        promptLabel: options.promptLabel ?? null,
        promptPlaceholder: options.promptPlaceholder ?? '',
        resolve,
      });
    });
  }

  private settle(ok: boolean): void {
    const a = this.active();
    if (a) {
      const reason = this.reasonInput().trim();
      this.active.set(null);
      a.resolve({ ok, reason });
    }
  }

  confirm(): void { this.settle(true); }
  cancel(): void { this.settle(false); }
}
