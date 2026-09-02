import type { HitReactionConfig } from '../config/gameConfig';

// エンティティ時間とヒットストップ(F10)。ヒットストップ中は当該エンティティの時間スケールを 0 にする。
// 残りステップ数はワールド時間で減らす。

/** 重複時は加算せず max に置き換える(F10 重複)。 */
export function requestHitstop(currentSteps: number, newSteps: number): number {
  return Math.max(currentSteps, newSteps);
}

/** ワールド時間で 1 ステップ進める。 */
export function tickHitstop(steps: number): number {
  return Math.max(0, steps - 1);
}

/** ヒットストップ中は 0、それ以外は 1。 */
export function timeScale(steps: number): 0 | 1 {
  return steps > 0 ? 0 : 1;
}

/** 1 回の攻撃(1 段・1 スキル・1 バースト)で攻撃側に掛かる合計の上限を管理する。 */
export interface AttackerHitstopBudget {
  readonly attackId: number;
  readonly usedSteps: number;
}

export function createAttackerHitstopBudget(attackId: number): AttackerHitstopBudget {
  return { attackId, usedSteps: 0 };
}

export interface AttackerHitstopResult {
  readonly steps: number;
  readonly budget: AttackerHitstopBudget;
}

/**
 * 攻撃側へのヒットストップを、上限(attackerHitstopCapSteps)の範囲で適用する。
 * 同一ステップで複数の敵にヒットした場合、呼び出し側は被弾側ごとの値の最大値を 1 回だけ渡す。
 */
export function applyAttackerHitstop(
  current: number,
  request: number,
  budget: AttackerHitstopBudget,
  config: HitReactionConfig,
): AttackerHitstopResult {
  const available = Math.max(0, config.attackerHitstopCapSteps - budget.usedSteps);
  const granted = Math.min(request, available);
  return {
    steps: requestHitstop(current, granted),
    budget: { ...budget, usedSteps: budget.usedSteps + granted },
  };
}
