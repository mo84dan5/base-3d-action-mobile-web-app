import type { EffectPort } from '../../application/ports';
import type { EffectEvent } from '../../application/effects';

// 振動(F03 / F10)。対応ブラウザ(Android Chrome)のみ。非対応環境では何もしない。
export class NavigatorVibration implements EffectPort {
  constructor(private readonly buttonPressMs: number) {}

  trigger(event: EffectEvent): void {
    if (event.kind === 'vibrate') this.vibrate(event.ms);
    if (event.kind === 'buttonPress') this.vibrate(this.buttonPressMs);
  }

  private vibrate(ms: number): void {
    if (ms <= 0) return;
    try {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(ms);
    } catch {
      // 非対応
    }
  }
}
