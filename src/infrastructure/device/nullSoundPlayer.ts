import type { EffectPort } from '../../application/ports';
import type { EffectEvent } from '../../application/effects';

// SE プレイヤー(本バージョンは空実装。発火点のみ F10 で定める)。
export class NullSoundPlayer implements EffectPort {
  trigger(_event: EffectEvent): void {
    // 音素材は対象外
  }
}
