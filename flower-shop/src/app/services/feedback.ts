import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class FeedbackService {
  private audioCtx: AudioContext | null = null;

  private getAudioContext(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    return this.audioCtx;
  }

  private playTone(ctx: AudioContext, freq: number, startDelay: number, duration: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime + startDelay);

    gain.gain.setValueAtTime(0, ctx.currentTime + startDelay);
    gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + startDelay + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startDelay + duration);

    osc.start(ctx.currentTime + startDelay);
    osc.stop(ctx.currentTime + startDelay + duration);
  }

  playAddSound(): void {
    try {
      const ctx = this.getAudioContext();
      // Pleasant two-note ascending chime: C5 → G5
      this.playTone(ctx, 523.25, 0, 0.12);
      this.playTone(ctx, 783.99, 0.1, 0.18);
    } catch {
      // silently ignore if audio is not supported
    }
  }

  vibrate(): void {
    if ('vibrate' in navigator) {
      navigator.vibrate(50);
    }
  }

  playRemoveSound(): void {
    try {
      const ctx = this.getAudioContext();
      // Descending two-note tone: G5 → C5
      this.playTone(ctx, 783.99, 0, 0.12);
      this.playTone(ctx, 523.25, 0.1, 0.18);
    } catch {
      // silently ignore if audio is not supported
    }
  }

  addToCartFeedback(): void {
    this.playAddSound();
    this.vibrate();
  }

  removeFromCartFeedback(): void {
    this.playRemoveSound();
    this.vibrate();
  }
}