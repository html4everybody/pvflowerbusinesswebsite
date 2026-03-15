import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ConfettiService {
  private colors = ['#c84b7a', '#e07aaa', '#ffc8df', '#ffd700', '#ffffff', '#f9e4ed', '#ff6b9d'];

  burst(): void {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999';
    document.body.appendChild(canvas);
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const ctx = canvas.getContext('2d')!;
    const pieces = Array.from({ length: 140 }, () => this.createPiece(canvas.width));

    let frame = 0;
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        p.y += p.speed;
        p.x += p.drift;
        p.rotation += p.rotationSpeed;
        p.opacity = Math.max(0, 1 - (p.y / canvas.height) * 1.1);

        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        }
        ctx.restore();
      });

      frame++;
      if (frame < 160) {
        requestAnimationFrame(animate);
      } else {
        canvas.remove();
      }
    };

    animate();
  }

  private createPiece(width: number) {
    return {
      x: Math.random() * width,
      y: -20,
      size: 6 + Math.random() * 10,
      speed: 3 + Math.random() * 5,
      drift: (Math.random() - 0.5) * 3,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.2,
      color: this.colors[Math.floor(Math.random() * this.colors.length)],
      shape: Math.random() > 0.5 ? 'circle' : 'rect',
      opacity: 1
    };
  }
}
