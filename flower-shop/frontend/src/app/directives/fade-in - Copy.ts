import { Directive, ElementRef, Input, OnInit } from '@angular/core';

@Directive({
  selector: '[appFadeIn]',
  standalone: true
})
export class FadeInDirective implements OnInit {
  @Input() fadeDelay: number = 0;

  constructor(private el: ElementRef) {}

  ngOnInit(): void {
    const el = this.el.nativeElement as HTMLElement;
    el.style.opacity = '0';
    el.style.transform = 'translateY(28px)';
    el.style.transition = `opacity 0.65s ease ${this.fadeDelay}ms, transform 0.65s ease ${this.fadeDelay}ms`;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
          observer.disconnect();
        }
      },
      { threshold: 0.12 }
    );

    observer.observe(el);
  }
}
