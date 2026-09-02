import { FIXED_STEP_SECONDS, MAX_SUBSTEPS_PER_FRAME } from '../domain/config/gameConfig';

// 固定タイムステップの更新ループ(F05 更新ループ)。描画フレームレートと物理更新を分離する。
export interface LoopAccumulator {
  readonly accumulated: number;
}

export const initialAccumulator: LoopAccumulator = { accumulated: 0 };

export interface LoopAdvance {
  readonly accumulator: LoopAccumulator;
  /** このフレームで実行する物理ステップ数(最大 4) */
  readonly steps: number;
  /** 前後の物理状態の補間係数(0〜1) */
  readonly alpha: number;
}

/**
 * フレーム経過秒を蓄積し、実行すべきステップ数と補間係数を返す。
 * 4 ステップを超える遅延は捨てる(スパイラル防止)。
 */
export function advanceLoop(acc: LoopAccumulator, frameSeconds: number): LoopAdvance {
  const maxAccumulated = FIXED_STEP_SECONDS * MAX_SUBSTEPS_PER_FRAME;
  const accumulated = Math.min(acc.accumulated + Math.max(0, frameSeconds), maxAccumulated);
  const steps = Math.floor(accumulated / FIXED_STEP_SECONDS + 1e-9);
  const remainder = accumulated - steps * FIXED_STEP_SECONDS;
  return {
    accumulator: { accumulated: Math.max(0, remainder) },
    steps,
    alpha: Math.max(0, remainder) / FIXED_STEP_SECONDS,
  };
}
