import type { AttackTiming, NormalAttackStage } from '../config/gameConfig';

// 通常攻撃 3 段コンボと攻撃タイミング(F04)。
export type ComboStage = 1 | 2 | 3;
export type AttackPhase = 'startup' | 'active' | 'recovery' | 'done';

/**
 * 次に出す段。3 段目の後は入力タイミングに関係なく 1 段目、猶予(全体時間の終了後 0.8 秒)を超えても 1 段目。
 */
export function nextComboStage(
  lastStage: 0 | ComboStage,
  comboWindowRemaining: number,
): ComboStage {
  if (lastStage === 0 || lastStage === 3) return 1;
  if (comboWindowRemaining <= 0) return 1;
  return (lastStage + 1) as ComboStage;
}

export function attackPhase(elapsed: number, timing: AttackTiming): AttackPhase {
  if (elapsed >= timing.total) return 'done';
  if (elapsed < timing.startup) return 'startup';
  if (elapsed < timing.startup + timing.active) return 'active';
  return 'recovery';
}

export function isInActiveWindow(elapsed: number, timing: AttackTiming): boolean {
  return attackPhase(elapsed, timing) === 'active';
}

/** 前進量は発生〜持続の間に等速で進む。このステップ(elapsed → elapsed + dt)で進む距離。 */
export function advanceDistanceThisStep(
  elapsed: number,
  dt: number,
  stage: NormalAttackStage,
): number {
  const moveEnd = stage.startup + stage.active;
  if (moveEnd <= 0) return 0;
  const from = Math.min(Math.max(elapsed, 0), moveEnd);
  const to = Math.min(Math.max(elapsed + dt, 0), moveEnd);
  return (stage.advance * (to - from)) / moveEnd;
}

/** 発生前のジャンプ・ダッシュ入力は攻撃をキャンセルできる。 */
export function canCancelAttack(elapsed: number, timing: AttackTiming): boolean {
  return elapsed < timing.startup;
}
