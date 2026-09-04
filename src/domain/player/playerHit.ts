import type { HitResolution } from '../combat/damage';
import { ZERO3, scale, vec3, type Vec3 } from '../math/vec3';
import { requestHitstop } from '../hitReaction/entityTime';
import type { PlayerState } from './playerState';
import type { PlayerEvent } from './playerEvents';

// プレイヤーへの被弾適用(F04 状態別の被弾処理 / F10 処理フロー)。
// HP 減算とヒットストップは即時、硬直・ノックバック・無敵・状態遷移はヒットストップ終了後に適用する。

export function applyPlayerHit(
  player: PlayerState,
  resolution: HitResolution,
  wallNormal: Vec3 | null,
): { player: PlayerState; events: PlayerEvent[] } {
  const hp = Math.max(0, player.hp - resolution.damage);
  if (hp <= 0) {
    return {
      player: {
        ...player,
        hp: 0,
        name: 'dead',
        stateTime: 0,
        velocity: ZERO3,
        attack: null,
        climb: null,
        pendingHit: null,
        hitstopSteps: requestHitstop(player.hitstopSteps, resolution.hitstop.victim),
      },
      events: [{ type: 'died' }],
    };
  }
  const detachVelocity =
    resolution.stateTransition === 'toFall' && resolution.detachSpeed > 0 && wallNormal
      ? scale(wallNormal, resolution.detachSpeed)
      : null;
  return {
    player: {
      ...player,
      hp,
      hitstopSteps: requestHitstop(player.hitstopSteps, resolution.hitstop.victim),
      pendingHit: {
        stunSeconds: resolution.applyStun ? resolution.stunSeconds : 0,
        invincibleSeconds: resolution.invincibleSeconds,
        knockback: resolution.knockback,
        knockbackDecay: resolution.knockbackDecay,
        transition: resolution.stateTransition,
        detachVelocity,
      },
    },
    events: [],
  };
}

/** ヒットストップ終了の次ステップで予約済みの反応を適用する。 */
export function releasePendingPlayerHit(player: PlayerState): {
  player: PlayerState;
  events: PlayerEvent[];
} {
  const pending = player.pendingHit;
  if (pending === null) return { player, events: [] };
  const base: PlayerState = {
    ...player,
    pendingHit: null,
    invincibleRemaining: Math.max(player.invincibleRemaining, pending.invincibleSeconds),
    knockback: pending.knockback ?? player.knockback,
    knockbackRemaining: pending.knockback ? pending.knockbackDecay : player.knockbackRemaining,
  };
  switch (pending.transition) {
    case 'hitState': {
      const events: PlayerEvent[] = [{ type: 'stunned' }];
      if (player.name === 'charge') events.push({ type: 'chargeCancelled' });
      return {
        player: {
          ...base,
          name: 'hit',
          stateTime: 0,
          stunRemaining: pending.stunSeconds,
          velocity: ZERO3,
          attack: null,
          strong: null,
          chargeTime: 0,
          climb: null,
          lastAttackStage: 0,
          comboWindowRemaining: 0,
        },
        events,
      };
    }
    case 'toFall': {
      const wasClimb = player.name === 'climb';
      const wasGlide = player.name === 'glide';
      const velocity = pending.detachVelocity
        ? vec3(pending.detachVelocity.x, 0, pending.detachVelocity.z)
        : wasGlide
          ? vec3(player.velocity.x, Math.min(0, player.velocity.y), player.velocity.z)
          : player.velocity;
      const events: PlayerEvent[] = [];
      if (wasClimb) events.push({ type: 'climbDetached', reason: 'hit' });
      if (wasGlide) events.push({ type: 'glideEnded', reason: 'hit' });
      return {
        player: { ...base, name: 'fall', stateTime: 0, velocity, climb: null, grounded: false },
        events,
      };
    }
    default:
      return { player: base, events: [] };
  }
}

/** 現在のノックバック速度(硬直 0.3 秒で線形に 0 へ)。 */
export function currentPlayerKnockback(player: PlayerState, decay: number): Vec3 {
  if (player.knockbackRemaining <= 0 || decay <= 0) return ZERO3;
  const k = player.knockbackRemaining / decay;
  return vec3(player.knockback.x * k, 0, player.knockback.z * k);
}
