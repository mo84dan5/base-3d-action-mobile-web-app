import type { GuardSpec } from '../../attackStyle/actionSpec';
import { degToRad } from '../../config/gameConfig';
import {
  ZERO3,
  horizontal,
  scale,
  sub,
  wrapAngle,
  yawFromDirection,
  type Vec3,
} from '../../math/vec3';
import { drainStamina, isStaminaEmpty } from '../../stamina/stamina';
import type { PlayerState } from '../playerState';
import {
  enter,
  enterSlide,
  finishAction,
  groundSpeedFor,
  moveGrounded,
  regen,
  startFall,
  turnTowards,
  withStamina,
  type Ctx,
  type StartActionOptions,
} from '../stepCore';
import { newAttack, newRuntime, tickHoldCost } from './runtime';

// N5 ガード / パリィ(F11)。受けの窓の間、正面 angleDeg の攻撃を軽減・無効化し、成功時にカウンター等を行う。
// 成功の判定は application(敵の攻撃が当たった瞬間)が guardCheck で行い、guardSucceeded を呼ぶ。

/** 長押しで維持するガード(窓がこの秒以上なら離すまで) */
const HELD_GUARD_WINDOW = 3.0;

export function startGuard(
  p: PlayerState,
  ctx: Ctx,
  spec: GuardSpec,
  opts: StartActionOptions,
): PlayerState | null {
  if (!p.grounded) return null;
  const { attackId, attack } = newAttack(p, 1);
  ctx.events.push({ type: 'guardStarted', spec });
  return {
    ...enter(p, 'guard'),
    velocity: ZERO3,
    attackCounter: attackId,
    attack,
    strong: null,
    action: newRuntime(spec, 'medium', opts, ctx.input.style.id, { phase: 'guard' }),
  };
}

export interface GuardCheck {
  readonly blocked: boolean;
  readonly reduction: number;
  readonly spec: GuardSpec | null;
}

/** 攻撃側の中心がガードの正面 ±angleDeg/2 にあり、受けの窓の中なら防ぐ。 */
export function guardCheck(p: PlayerState, attackerCenter: Vec3): GuardCheck {
  const runtime = p.action;
  if (p.name !== 'guard' || runtime?.spec.kind !== 'guard' || runtime.phase !== 'guard') {
    return { blocked: false, reduction: 0, spec: null };
  }
  const spec = runtime.spec;
  const to = horizontal(sub(attackerCenter, p.position));
  const yaw = to.x === 0 && to.z === 0 ? p.yaw : yawFromDirection(to);
  const within = Math.abs(wrapAngle(yaw - p.yaw)) <= degToRad(spec.angleDeg) / 2;
  if (!within) return { blocked: false, reduction: 0, spec };
  return { blocked: true, reduction: spec.reduction, spec };
}

/** ガード成功を記録する(application から)。次のステップでカウンター等に進む。 */
export function guardSucceeded(p: PlayerState): PlayerState {
  if (p.name !== 'guard' || !p.action) return p;
  return { ...p, action: { ...p.action, succeeded: true, phase: 'success' } };
}

function counterAction(spec: GuardSpec) {
  return {
    kind: 'area' as const,
    damage: spec.counterDamage,
    shape: { type: 'sphere' as const, radius: 1.5, forward: 1.0 },
    startup: 0.05,
    active: 0.1,
    total: 0.5,
    knockback: 4.0,
    hitClass: 'heavy' as const,
    energyPerHit: 10,
    movement: 'stop' as const,
    ...(spec.toppleSeconds > 0 ? { stunSeconds: spec.toppleSeconds } : {}),
  };
}

export function stepGuard(p: PlayerState, ctx: Ctx): PlayerState {
  const runtime = p.action;
  if (runtime?.spec.kind !== 'guard') return finishAction(p, ctx);
  const spec = runtime.spec;
  const { config, dt, input } = ctx;
  const elapsed = runtime.elapsed + dt;
  if (runtime.phase === 'success') {
    if ((spec.onSuccess === 'counter' || spec.autoRiposte) && spec.counterDamage > 0) {
      ctx.events.push({ type: 'guardEnded', reason: 'counter' });
      const counter = ctx.startAction({ ...p, action: null }, ctx, counterAction(spec), {
        source: runtime.source,
        then: runtime.then,
      });
      if (counter) return counter;
    }
    ctx.events.push({ type: 'guardEnded', reason: 'success' });
    return finishAction(p, ctx);
  }
  if (runtime.phase === 'recover') {
    const next = { ...p, stateTime: p.stateTime + dt, action: { ...runtime, elapsed } };
    const moved = moveGrounded(next, ctx, ZERO3);
    if (elapsed < spec.failRecovery) return regen(moved.next, ctx, true);
    ctx.events.push({ type: 'guardEnded', reason: 'timeout' });
    return finishAction(moved.next, ctx);
  }
  let paid: PlayerState | null = tickHoldCost(p, ctx);
  if (paid && spec.staminaPerSecond > 0) {
    paid = withStamina(
      paid,
      ctx,
      drainStamina(paid.stamina, spec.staminaPerSecond, dt, config.stamina),
    );
    if (isStaminaEmpty(paid.stamina)) paid = null;
  }
  if (input.attackHoldEnd && runtime.source === 'hold') {
    ctx.events.push({ type: 'guardEnded', reason: 'release' });
    if (spec.release) {
      const released = ctx.startAction({ ...(paid ?? p), action: null }, ctx, spec.release, {
        source: 'hold',
        then: runtime.then,
      });
      if (released) return released;
    }
    return finishAction(paid ?? p, ctx);
  }
  if (paid === null) {
    ctx.events.push({ type: 'guardEnded', reason: 'timeout' });
    return finishAction(p, ctx);
  }
  let next: PlayerState = { ...paid, stateTime: p.stateTime + dt, action: { ...runtime, elapsed } };
  let velocity = ZERO3;
  if (spec.moveSpeed > 0 && ctx.magnitude > 0) {
    velocity = scale(ctx.moveDir, Math.min(spec.moveSpeed, groundSpeedFor(ctx.magnitude, config)));
    next = turnTowards(next, ctx.moveDir, config.movement.turnSpeedDeg, dt);
  }
  const moved = moveGrounded(next, ctx, velocity);
  next = moved.next;
  if (moved.outcome === 'fell') return startFall(next, ctx, false);
  if (moved.outcome === 'slide') return enterSlide(next, ctx);
  next = regen(next, ctx, false);
  const held = spec.window >= HELD_GUARD_WINDOW && runtime.source === 'hold';
  if (held || elapsed < spec.window) return next;
  if (spec.failRecovery > 0)
    return { ...next, action: { ...runtime, elapsed: 0, phase: 'recover' } };
  ctx.events.push({ type: 'guardEnded', reason: 'timeout' });
  return finishAction(next, ctx);
}
