import { Component, Input, forwardRef, signal, HostListener, ElementRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

interface Cell {
  date: string; day: number; inMonth: boolean;
  disabled: boolean; today: boolean; selected: boolean;
}

/**
 * Premium calendar date-picker. Drop-in replacement for <input type="date">.
 * Works with [(ngModel)] (implements ControlValueAccessor) and honours Angular's
 * `required` validator, since it writes '' when nothing is selected.
 * Value format is 'YYYY-MM-DD' — identical to the native date input.
 */
@Component({
  selector: 'app-date-picker',
  standalone: true,
  templateUrl: './date-picker.html',
  styleUrl: './date-picker.scss',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DatePicker), multi: true },
  ],
})
export class DatePicker implements ControlValueAccessor {
  @Input() min?: string;            // 'YYYY-MM-DD' — earliest selectable date
  @Input() max?: string;            // 'YYYY-MM-DD' — latest selectable date
  @Input() placeholder = 'Select a date';

  value = signal('');
  disabled = signal(false);
  open = signal(false);
  viewMonth = signal(new Date());
  // Popup normally opens anchored to the trigger's left edge. When the
  // trigger sits close enough to the right edge of the viewport that a
  // left-anchored popup would run off-screen (e.g. admin's Orders date
  // filter, which sits at the far right of its search bar), the "next
  // month" button ends up unreachable. Flip to right-anchored instead.
  alignRight = signal(false);

  readonly weekdayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  constructor(private host: ElementRef<HTMLElement>) {}

  // ── ControlValueAccessor ─────────────────────────────────────────────────
  writeValue(v: string): void {
    this.value.set(v || '');
    if (v) this.viewMonth.set(new Date(v));
  }
  registerOnChange(fn: (v: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(d: boolean): void { this.disabled.set(d); }

  // ── Labels ───────────────────────────────────────────────────────────────
  private ymd(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  get monthLabel(): string {
    return this.viewMonth().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }

  get triggerLabel(): string {
    const v = this.value();
    if (!v) return this.placeholder;
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  get canGoPrev(): boolean {
    if (!this.min) return true;
    const v = this.viewMonth();
    const m = new Date(this.min);
    return v.getFullYear() > m.getFullYear() ||
      (v.getFullYear() === m.getFullYear() && v.getMonth() > m.getMonth());
  }

  get canGoNext(): boolean {
    if (!this.max) return true;
    const v = this.viewMonth();
    const m = new Date(this.max);
    return v.getFullYear() < m.getFullYear() ||
      (v.getFullYear() === m.getFullYear() && v.getMonth() < m.getMonth());
  }

  get cells(): Cell[] {
    const view = this.viewMonth();
    const year = view.getFullYear(), month = view.getMonth();
    const startOffset = new Date(year, month, 1).getDay();
    const gridStart = new Date(year, month, 1 - startOffset);
    const todayStr = this.ymd(new Date());
    const out: Cell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const ds = this.ymd(d);
      out.push({
        date: ds, day: d.getDate(),
        inMonth: d.getMonth() === month,
        disabled: (!!this.min && ds < this.min) || (!!this.max && ds > this.max),
        today: ds === todayStr,
        selected: ds === this.value(),
      });
    }
    return out;
  }

  // ── Interaction ──────────────────────────────────────────────────────────
  toggle(): void {
    if (this.disabled()) return;
    const next = !this.open();
    this.open.set(next);
    if (next) {
      this.viewMonth.set(this.value() ? new Date(this.value()) : new Date());
      const rect = this.host.nativeElement.getBoundingClientRect();
      const popupWidth = Math.min(312, window.innerWidth * 0.92);
      this.alignRight.set(rect.left + popupWidth > window.innerWidth - 8);
    } else {
      this.onTouched();
    }
  }

  prevMonth(): void {
    if (!this.canGoPrev) return;
    const v = this.viewMonth();
    this.viewMonth.set(new Date(v.getFullYear(), v.getMonth() - 1, 1));
  }
  nextMonth(): void {
    if (!this.canGoNext) return;
    const v = this.viewMonth();
    this.viewMonth.set(new Date(v.getFullYear(), v.getMonth() + 1, 1));
  }

  pick(cell: Cell): void {
    if (cell.disabled) return;
    this.value.set(cell.date);
    this.onChange(cell.date);
    this.open.set(false);
    this.onTouched();
  }

  close(): void {
    if (this.open()) { this.open.set(false); this.onTouched(); }
  }

  @HostListener('document:keydown.escape')
  onEsc(): void { this.close(); }
}
