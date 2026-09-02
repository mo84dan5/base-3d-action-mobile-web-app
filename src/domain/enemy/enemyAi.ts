import type { EnemyConfig } from '../config/gameConfig';
import { attackPhase } from '../combat/comboState';
import { attackSpherePosition } from '../combat/hitGeometry';
import {
  ZERO3,
  directionFromYaw,
  distance,
  horizontal,
  normalize,
  scale,
  sub,
  yawFromDirection,
  type Vec3,
} from '../math/vec3';
import { enemyCenter, type EnemyState } from './enemyState';

// 徘徊型の AI(F04)。待機 → 追跡 → 攻撃 → 追跡、被弾 → 硬直 → 追跡。ダミーは何もしない。

export type EnemyEvent =
  | { readonly type: 'attackStart'; readonly enemyId: number }
  | {
      readonly type: 'attackActive';
      readonly enemyId: number;
      readonly attackId: number;
      readonly sphereCenter: Vec3;
      readonly radius: number;
    }
  | { readonly type: 'attackEnd'; readonly enemyId: number }
  | { readonly type: 'stunEnd'; readonly enemyId: number };

export interface EnemyStepResult {
  readonly enemy: EnemyState;
  readonly events: readonly EnemyEvent[];
}

function centerDistance(enemy: EnemyState, playerCenter: Vec3, config: EnemyConfig): number {
  return distance(enemyCenter(enemy, config), playerCenter);
}

function heightDiff(enemy: EnemyState, playerCenter: Vec3, config: EnemyConfig): number {
  return Math.abs(enemyCenter(enemy, config).y - playerCenter.y);
}

function faceTo(enemy: EnemyState, playerCenter: Vec3): number {
  const toPlayer = horizontal(sub(playerCenter, enemy.position));
  if (toPlayer.x === 0 && toPlayer.z === 0) return enemy.yaw;
  return yawFromDirection(toPlayer);
}

function canStartAttack(enemy: EnemyState, playerCenter: Vec3, config: EnemyConfig): boolean {
  return (
    centerDistance(enemy, playerCenter, config) <= config.attackDistance &&
    heightDiff(enemy, playerCenter, config) <= config.attackMaxHeightDiff &&
    enemy.attackCooldownRemaining <= 0
  );
}

function stepIdle(enemy: EnemyState, playerCenter: Vec3, config: EnemyConfig): EnemyState {
  if (centerDistance(enemy, playerCenter, config) <= config.chaseStartDistance) {
    return { ...enemy, ai: 'chase', stateTime: 0 };
  }
  return { ...enemy, velocity: ZERO3 };
}

function stepChase(enemy: EnemyState, playerCenter: Vec3, config: EnemyConfig): EnemyStepResult {
  if (centerDistance(enemy, playerCenter, config) >= config.chaseStopDistance) {
    return { enemy: { ...enemy, ai: 'idle', stateTime: 0, velocity: ZERO3 }, events: [] };
  }
  const yaw = faceTo(enemy, playerCenter);
  if (canStartAttack(enemy, playerCenter, config)) {
    return {
      enemy: {
        ...enemy,
        ai: 'attack',
        stateTime: 0,
        yaw,
        velocity: ZERO3,
        attackId: enemy.attackId + 1,
        attackHitDone: false,
      },
      events: [{ type: 'attackStart', enemyId: enemy.id }],
    };
  }
  const dir = normalize(horizontal(sub(playerCenter, enemy.position)));
  return {
    enemy: { ...enemy, yaw, velocity: scale(dir, config.moveSpeed) },
    events: [],
  };
}

function stepAttack(enemy: EnemyState, config: EnemyConfig): EnemyStepResult {
  const phase = attackPhase(enemy.stateTime, config.attack);
  if (phase === 'done') {
    return {
      enemy: {
        ...enemy,
        ai: 'chase',
        stateTime: 0,
        attackCooldownRemaining: config.attackCooldown,
      },
      events: [{ type: 'attackEnd', enemyId: enemy.id }],
    };
  }
  if (phase !== 'active') return { enemy: { ...enemy, velocity: ZERO3 }, events: [] };
  return {
    enemy: { ...enemy, velocity: ZERO3 },
    events: [
      {
        type: 'attackActive',
        enemyId: enemy.id,
        attackId: enemy.attackId,
        sphereCenter: attackSpherePosition(
          enemy.position,
          enemy.yaw,
          config.attackForward,
          config.capsuleHeight / 2,
        ),
        radius: config.attackRadius,
      },
    ],
  };
}

function stepStunned(enemy: EnemyState, dt: number): EnemyStepResult {
  const stunRemaining = enemy.stunRemaining - dt;
  if (stunRemaining > 0) {
    return { enemy: { ...enemy, stunRemaining, velocity: ZERO3 }, events: [] };
  }
  return {
    enemy: { ...enemy, ai: 'chase', stateTime: 0, stunRemaining: 0, velocity: ZERO3 },
    events: [{ type: 'stunEnd', enemyId: enemy.id }],
  };
}

/**
 * AI を dt(エンティティ時間で既にスケール済み)だけ進める。位置の更新は行わず、velocity を決めるのみ。
 * ヒットストップ中(dt = 0)は何も変化しない。
 */
export function stepEnemyAi(
  enemy: EnemyState,
  playerCenter: Vec3,
  playerAlive: boolean,
  dt: number,
  config: EnemyConfig,
): EnemyStepResult {
  if (dt <= 0 || enemy.kind === 'dummy' || enemy.ai === 'dying' || enemy.ai === 'dead') {
    return { enemy, events: [] };
  }
  const advanced: EnemyState = {
    ...enemy,
    stateTime: enemy.stateTime + dt,
    attackCooldownRemaining: Math.max(0, enemy.attackCooldownRemaining - dt),
  };
  if (!playerAlive) {
    return { enemy: { ...advanced, ai: 'idle', velocity: ZERO3 }, events: [] };
  }
  switch (advanced.ai) {
    case 'idle':
      return { enemy: stepIdle(advanced, playerCenter, config), events: [] };
    case 'chase':
      return stepChase(advanced, playerCenter, config);
    case 'attack':
      return stepAttack(advanced, config);
    case 'stunned':
      return stepStunned(advanced, dt);
    default:
      return { enemy: advanced, events: [] };
  }
}

/** 攻撃の予兆(発生 0.6 秒間)を表示すべきか。 */
export function isTelegraphing(enemy: EnemyState, config: EnemyConfig): boolean {
  return enemy.ai === 'attack' && attackPhase(enemy.stateTime, config.attack) === 'startup';
}

/** 予兆の濃さ: 発生の最後の 0.15 秒で不透明 50% → 80%(デザインディレクション)。 */
export function telegraphOpacity(enemy: EnemyState, config: EnemyConfig): number {
  if (!isTelegraphing(enemy, config)) return 0;
  return config.attack.startup - enemy.stateTime <= 0.15 ? 0.8 : 0.5;
}

export function enemyFacing(enemy: EnemyState): Vec3 {
  return directionFromYaw(enemy.yaw);
}
