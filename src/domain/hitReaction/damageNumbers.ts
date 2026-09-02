import { FIXED_STEP_SECONDS, type HitReactionConfig } from '../config/gameConfig';
import { clamp, type Vec3 } from '../math/vec3';

// ダメージ数値(F10 スタイル / S02 要素 12)。0.8 秒で上昇しながらフェードアウトする。
export type DamageNumberKind = 'normal' | 'big' | 'playerHit';
export type DamageTargetId = number | 'player';

export interface DamageNumber {
  readonly id: number;
  readonly targetId: DamageTargetId;
  readonly amount: number;
  readonly kind: DamageNumberKind;
  /** 表示の基準位置(対象の頭上) */
  readonly worldPosition: Vec3;
  /** 同一対象への連続ヒットで 0.3 m ずつ上にずらす段数 */
  readonly stackIndex: number;
  /** 経過秒(ワールド時間) */
  readonly age: number;
}

export interface DamageNumberSpawn {
  readonly targetId: DamageTargetId;
  readonly amount: number;
  readonly isPlayerAttack: boolean;
  readonly anchor: Vec3;
}

export interface DamageNumberVisual {
  readonly riseMeters: number;
  readonly opacity: number;
  readonly scale: number;
  readonly color: 'white' | 'yellow' | 'red';
}

const FADE_SECONDS = 0.3;
const APPEAR_STEPS = 2;
const BIG_SCALE = 1.4;
const BIG_POP_START = 1.2;

function kindOf(spawn: DamageNumberSpawn, config: HitReactionConfig): DamageNumberKind {
  if (spawn.targetId === 'player') return 'playerHit';
  if (spawn.isPlayerAttack && spawn.amount >= config.bigDamageThreshold) return 'big';
  return 'normal';
}

/** 同一対象の表示数が上限(3)を超えたら最古を即時消す。 */
export function spawnDamageNumber(
  list: readonly DamageNumber[],
  spawn: DamageNumberSpawn,
  config: HitReactionConfig,
  nextId: number,
): readonly DamageNumber[] {
  const sameTarget = list.filter((n) => n.targetId === spawn.targetId);
  let kept = list;
  if (sameTarget.length >= config.damageNumberMaxStack) {
    const oldest = sameTarget.reduce((a, b) => (b.age > a.age ? b : a));
    kept = list.filter((n) => n.id !== oldest.id);
  }
  const stackIndex = kept.filter((n) => n.targetId === spawn.targetId).length;
  const created: DamageNumber = {
    id: nextId,
    targetId: spawn.targetId,
    amount: spawn.amount,
    kind: kindOf(spawn, config),
    worldPosition: {
      x: spawn.anchor.x,
      y: spawn.anchor.y + config.damageNumberStackOffset * stackIndex,
      z: spawn.anchor.z,
    },
    stackIndex,
    age: 0,
  };
  return [...kept, created];
}

/** 経過秒を進め、寿命(0.8 秒)を過ぎたものを消す。 */
export function tickDamageNumbers(
  list: readonly DamageNumber[],
  dt: number,
  config: HitReactionConfig,
): readonly DamageNumber[] {
  return list
    .map((n) => ({ ...n, age: n.age + dt }))
    .filter((n) => n.age < config.damageNumberLifetime);
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function damageNumberVisual(n: DamageNumber, config: HitReactionConfig): DamageNumberVisual {
  const lifetime = config.damageNumberLifetime;
  const t = clamp(n.age / lifetime, 0, 1);
  const riseMeters = config.damageNumberRise * easeOut(t);
  const appearSeconds = APPEAR_STEPS * FIXED_STEP_SECONDS;
  const appear = clamp(n.age / appearSeconds, 0, 1);
  const fadeStart = lifetime - FADE_SECONDS;
  const fade = n.age <= fadeStart ? 1 : clamp((lifetime - n.age) / FADE_SECONDS, 0, 1);
  const opacity = Math.min(appear, fade);
  const scale = n.kind === 'big' ? BIG_SCALE * (BIG_POP_START - (BIG_POP_START - 1) * appear) : 1;
  const color = n.kind === 'big' ? 'yellow' : n.kind === 'playerHit' ? 'red' : 'white';
  return { riseMeters, opacity, scale, color };
}
