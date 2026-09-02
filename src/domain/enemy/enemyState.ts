import type { EnemyConfig, GameConfig } from '../config/gameConfig';
import { ZERO3, type Vec3 } from '../math/vec3';
import type { HitResolution } from '../combat/damage';
import { startFlash, type HitFlash } from '../hitReaction/hitFlash';
import { requestHitstop } from '../hitReaction/entityTime';

// 敵の状態(F04 敵)。ダミー(不動・撃破対象外)と徘徊型(AI・撃破対象)。

export type EnemyKind = 'dummy' | 'patrol';
export type EnemyAiState = 'idle' | 'chase' | 'attack' | 'stunned' | 'dying' | 'dead';

export interface PendingReaction {
  readonly stunSeconds: number;
  readonly knockback: Vec3 | null;
  readonly knockbackDecay: number;
}

export interface EnemyState {
  readonly id: number;
  readonly kind: EnemyKind;
  readonly ai: EnemyAiState;
  /** 足元位置 */
  readonly position: Vec3;
  /** AI が決める移動速度(水平)。物理側がこれで位置を進める */
  readonly velocity: Vec3;
  readonly yaw: number;
  readonly hp: number;
  readonly maxHp: number;
  /** 現在の AI 状態に入ってからの経過秒(エンティティ時間) */
  readonly stateTime: number;
  readonly attackCooldownRemaining: number;
  /** 攻撃ごとに増える ID(同一攻撃で同一対象に 1 回だけヒット) */
  readonly attackId: number;
  readonly attackHitDone: boolean;
  readonly stunRemaining: number;
  /** 最後に硬直を適用したワールド時間(秒)。1.0 秒に 1 回の制限に使う */
  readonly lastStunTime: number;
  readonly hitstopSteps: number;
  readonly knockback: Vec3;
  readonly knockbackRemaining: number;
  readonly knockbackDecay: number;
  readonly flash: HitFlash | null;
  readonly hpBarVisibleRemaining: number;
  /** 撃破演出の経過秒(ワールド時間) */
  readonly deathTime: number;
  readonly grounded: boolean;
  /** ヒットストップ終了後に適用する硬直・ノックバック */
  readonly pending: PendingReaction | null;
}

export function createEnemy(
  id: number,
  kind: EnemyKind,
  position: Vec3,
  config: EnemyConfig,
): EnemyState {
  const maxHp = kind === 'dummy' ? config.dummyHp : config.patrolHp;
  return {
    id,
    kind,
    ai: 'idle',
    position,
    velocity: ZERO3,
    yaw: 0,
    hp: maxHp,
    maxHp,
    stateTime: 0,
    attackCooldownRemaining: 0,
    attackId: 0,
    attackHitDone: false,
    stunRemaining: 0,
    lastStunTime: -Infinity,
    hitstopSteps: 0,
    knockback: ZERO3,
    knockbackRemaining: 0,
    knockbackDecay: 0,
    flash: null,
    hpBarVisibleRemaining: 0,
    deathTime: 0,
    grounded: true,
    pending: null,
  };
}

/** ヒット判定・分離の対象か(HP > 0 で撃破演出中でない)。 */
export function isTargetable(enemy: EnemyState): boolean {
  return enemy.hp > 0 && enemy.ai !== 'dying' && enemy.ai !== 'dead';
}

/** 勝利条件に数える撃破対象か(徘徊型のみ)。 */
export function isDefeatTarget(enemy: EnemyState): boolean {
  return enemy.kind === 'patrol';
}

export function isDefeated(enemy: EnemyState): boolean {
  return enemy.ai === 'dying' || enemy.ai === 'dead';
}

/** 徘徊型の硬直は 1.0 秒に 1 回のみ(F04)。 */
export function canEnemyBeStunned(
  enemy: EnemyState,
  worldTime: number,
  config: EnemyConfig,
): boolean {
  return worldTime - enemy.lastStunTime >= config.hitStunInterval;
}

export function enemyCenter(enemy: EnemyState, config: EnemyConfig): Vec3 {
  return {
    x: enemy.position.x,
    y: enemy.position.y + config.capsuleHeight / 2,
    z: enemy.position.z,
  };
}

/**
 * ヒット結果を敵に適用する(F10 処理フロー 3・5・6・7・8)。
 * 硬直・ノックバックは pending に予約し、ヒットストップ終了後に releasePendingReactions で適用する。
 * ダミーは HP が 0 になったら即時に全回復する。徘徊型は HP 0 で撃破演出(dying)へ。
 */
export function applyEnemyHit(
  enemy: EnemyState,
  resolution: HitResolution,
  worldTime: number,
  config: GameConfig,
): EnemyState {
  const rawHp = Math.max(0, enemy.hp - resolution.damage);
  const hp = enemy.kind === 'dummy' && rawHp <= 0 ? enemy.maxHp : rawHp;
  const stunApplied = resolution.applyStun;
  const dying = enemy.kind === 'patrol' && hp <= 0;
  return {
    ...enemy,
    hp,
    flash: startFlash(resolution.flash, config.hitReaction),
    hitstopSteps: requestHitstop(enemy.hitstopSteps, resolution.hitstop.victim),
    hpBarVisibleRemaining: config.enemy.hpBarVisibleSeconds,
    lastStunTime: stunApplied ? worldTime : enemy.lastStunTime,
    pending: dying
      ? null
      : {
          stunSeconds: stunApplied ? resolution.stunSeconds : 0,
          knockback: resolution.knockback,
          knockbackDecay: resolution.knockbackDecay,
        },
    ai: dying ? 'dying' : enemy.ai,
    stateTime: dying ? 0 : enemy.stateTime,
    velocity: dying ? ZERO3 : enemy.velocity,
    deathTime: dying ? 0 : enemy.deathTime,
  };
}

/** ヒットストップ終了の次ステップで呼ぶ。予約した硬直・ノックバックを開始する。 */
export function releasePendingReactions(enemy: EnemyState): EnemyState {
  const pending = enemy.pending;
  if (pending === null) return enemy;
  const stunned = pending.stunSeconds > 0;
  return {
    ...enemy,
    pending: null,
    stunRemaining: stunned ? pending.stunSeconds : enemy.stunRemaining,
    ai: stunned && enemy.ai !== 'dying' && enemy.ai !== 'dead' ? 'stunned' : enemy.ai,
    stateTime: stunned ? 0 : enemy.stateTime,
    velocity: stunned ? ZERO3 : enemy.velocity,
    attackHitDone: stunned ? true : enemy.attackHitDone,
    knockback: pending.knockback ?? enemy.knockback,
    knockbackRemaining: pending.knockback ? pending.knockbackDecay : enemy.knockbackRemaining,
    knockbackDecay: pending.knockback ? pending.knockbackDecay : enemy.knockbackDecay,
  };
}

export type DeathPhase = 'hold' | 'collapse' | 'done';

export interface DeathProgress {
  readonly phase: DeathPhase;
  /** 崩れの進行(0 → 1) */
  readonly collapseRatio: number;
}

/** 撃破演出: ヒットストップ後 0.2 秒静止 → 0.8 秒で崩れ → 非表示(合計 1.0 秒)。 */
export function deathProgress(enemy: EnemyState, config: EnemyConfig): DeathProgress {
  if (enemy.deathTime < config.deathHoldTime) return { phase: 'hold', collapseRatio: 0 };
  const collapse = (enemy.deathTime - config.deathHoldTime) / config.deathCollapseTime;
  if (collapse >= 1) return { phase: 'done', collapseRatio: 1 };
  return { phase: 'collapse', collapseRatio: collapse };
}

/** 撃破演出をワールド時間で進める(ヒットストップ終了後に呼ぶ)。 */
export function tickDeath(enemy: EnemyState, dt: number, config: EnemyConfig): EnemyState {
  if (enemy.ai !== 'dying') return enemy;
  const deathTime = enemy.deathTime + dt;
  const done = deathTime >= config.deathHoldTime + config.deathCollapseTime;
  return { ...enemy, deathTime, ai: done ? 'dead' : 'dying' };
}

/** 現在のノックバック速度(0.3 秒で線形に 0 へ)。 */
export function currentKnockback(enemy: EnemyState): Vec3 {
  if (enemy.knockbackRemaining <= 0 || enemy.knockbackDecay <= 0) return ZERO3;
  const k = enemy.knockbackRemaining / enemy.knockbackDecay;
  return { x: enemy.knockback.x * k, y: 0, z: enemy.knockback.z * k };
}
