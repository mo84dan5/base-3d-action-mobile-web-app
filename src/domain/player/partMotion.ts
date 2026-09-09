import type { ActionSpec } from '../attackStyle/actionSpec';
import type { EquipmentSlot } from '../equipment/equipment';
import type { PlayerState } from './playerState';

// 技のモーション(F12 / デザインディレクション キャラクター)。実行中の技のスロットのパーツを
// どこまで動かすかを表示用に出す。ロジック(判定・向き)には影響しない。

export interface PartMotion {
  /** 動かすパーツ = 実行中の技のスロット */
  readonly part: EquipmentSlot;
  /** 行動の経過 / 全体(0〜1) */
  readonly progress: number;
  /** 長押しの行動か(突き出して保持 / 前傾を保持) */
  readonly hold: boolean;
}

/** 全体の長さを持たない行動(移動連動・強化・設置など)の見た目上の長さ(秒) */
export const DEFAULT_MOTION_SECONDS = 0.4;

/** 保持する長押し(タメ・ガード・押している間の連打)の progress の上限(保持の区間の中) */
const HELD_PROGRESS = 0.5;

/** 行動の見た目上の全体の長さ(秒)。多段ヒットは 1 ティックごとに往復する */
export function motionTotalOf(spec: ActionSpec, stage: number): number {
  switch (spec.kind) {
    case 'combo': {
      const s = spec.stages[stage - 1] ?? spec.stages[0];
      return s?.total ?? DEFAULT_MOTION_SECONDS;
    }
    case 'lunge':
    case 'hitscan':
    case 'area':
    case 'projectile':
      return spec.total;
    case 'multihit':
      return spec.interval;
    case 'pull':
      return spec.holdSeconds;
    default:
      return DEFAULT_MOTION_SECONDS;
  }
}

/** 離すまで続く行動(タメ・ガード・押している間の連打)は保持の姿勢で止める */
function openEnded(spec: ActionSpec): boolean {
  if (spec.kind === 'charge' || spec.kind === 'guard') return true;
  return spec.kind === 'multihit' && spec.whileHeld;
}

export function partMotionOf(p: PlayerState): PartMotion | null {
  const part = p.techniqueSlot;
  const action = p.action;
  if (part === null || !action) return null;
  const hold = action.source === 'hold';
  const elapsed = Math.max(0, action.elapsed);
  if (hold && openEnded(action.spec)) {
    return { part, progress: Math.min(HELD_PROGRESS, elapsed / DEFAULT_MOTION_SECONDS), hold };
  }
  const total = motionTotalOf(action.spec, p.attack?.stage ?? 1);
  if (total <= 0) return { part, progress: 1, hold };
  const cyclic = action.spec.kind === 'multihit';
  const t = cyclic ? elapsed % total : elapsed;
  return { part, progress: Math.min(1, t / total), hold };
}
