import type { HitReactionConfig } from '../config/gameConfig';

// ヒットフラッシュ(F10)。敵は白、プレイヤーは赤(不透明 80% → 0%)。6 ステップで線形減衰。ワールド時間で数える。
export type FlashColor = 'white' | 'red';

export interface HitFlash {
  readonly remainingSteps: number;
  readonly totalSteps: number;
  readonly color: FlashColor;
}

const RED_START_OPACITY = 0.8;

/** 重複した場合は再スタート(最大値に戻す)。 */
export function startFlash(color: FlashColor, config: HitReactionConfig): HitFlash {
  return { remainingSteps: config.flashSteps, totalSteps: config.flashSteps, color };
}

/** 1 ステップ減衰させる。0 になったら null(終了)。 */
export function tickFlash(flash: HitFlash | null): HitFlash | null {
  if (flash === null) return null;
  const remaining = flash.remainingSteps - 1;
  if (remaining <= 0) return null;
  return { ...flash, remainingSteps: remaining };
}

/** 強度 1 → 0 の線形減衰。 */
export function flashIntensity(flash: HitFlash | null): number {
  if (flash === null || flash.totalSteps <= 0) return 0;
  return flash.remainingSteps / flash.totalSteps;
}

/** 表示不透明度。赤(プレイヤー)は 80% から始まる。 */
export function flashOpacity(flash: HitFlash | null): number {
  if (flash === null) return 0;
  const start = flash.color === 'red' ? RED_START_OPACITY : 1.0;
  return flashIntensity(flash) * start;
}
