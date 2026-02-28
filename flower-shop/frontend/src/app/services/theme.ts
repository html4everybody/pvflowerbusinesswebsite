import { Injectable, signal, effect } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly isDark = signal<boolean>(this.loadTheme());

  constructor() {
    effect(() => {
      this.applyTheme(this.isDark());
    });
  }

  private loadTheme(): boolean {
    const stored = localStorage.getItem('floran_theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  private applyTheme(dark: boolean): void {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('floran_theme', dark ? 'dark' : 'light');
  }

  toggle(): void {
    this.isDark.update(v => !v);
  }
}
