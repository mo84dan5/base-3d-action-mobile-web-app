import type { ProjectileSpec } from '../../attackStyle/actionSpec';
import { ZERO3, directionFromYaw, vec3 } from '../../math/vec3';
import type { PlayerState } from '../playerState';
import {
  enter,
  enterSlide,
  finishAction,
  moveAirborne,
  moveGrounded,
  regen,
  type Ctx,
  type StartActionOptions,
} from '../stepCore';
import { kindOf, profileOf } from './hitProfile';
import {
  chainThen,
  correctedYaw,
  newAttack,
  newRuntime,
  scaledDamage,
  shotOrigin,
} from './runtime';

// N1 発射体(F11)。発生後に count 個を spread に並べて(interval > 0 なら順に)発射する。
// 弾の運動・命中は application が行う(projectileSpawned)。

/** 放物線の弾は上向きに 20 度で放つ。 */
const LOB_PITCH = (20 * Math.PI) / 180;

function launchDirection(yaw: number, gravity: boolean) {
  const flat = directionFromYaw(yaw);
  if (!gravity) return flat;
  return vec3(flat.x * Math.cos(LOB_PITCH), Math.sin(LOB_PITCH), flat.z * Math.cos(LOB_PITCH));
}

export function startThrow(
  p: PlayerState,
  ctx: Ctx,
  spec: ProjectileSpec,
  opts: StartActionOptions,
): PlayerState | null {
  if (!p.grounded && !spec.airborne) return null;
  const yaw = correctedYaw(p, ctx, spec.target);
  const kind = kindOf(spec.hitClass);
  const { attackId, attack } = newAttack(p, 1);
  const styleId = ctx.input.style.id;
  ctx.events.push({ type: 'attackStarted', kind, stage: 1, action: 'projectile', styleId });
  return {
    ...enter(p, 'throw'),
    yaw,
    velocity: p.grounded ? ZERO3 : p.velocity,
    attackCounter: attackId,
    attack,
    strong: null,
    action: newRuntime(spec, kind, opts, styleId, { nextAt: spec.startup }),
  };
}

function spawn(p: PlayerState, ctx: Ctx, spec: ProjectileSpec, index: number): void {
  const runtime = p.action;
  if (!runtime || !p.attack) return;
  const half = (spec.spreadDeg * Math.PI) / 360;
  const t = spec.count <= 1 ? 0.5 : index / (spec.count - 1);
  const yaw = spec.count <= 1 ? p.yaw : p.yaw - half + 2 * half * t;
  ctx.events.push({
    type: 'projectileSpawned',
    attackId: p.attack.attackId + index,
    spec,
    kind: runtime.kind,
    origin: shotOrigin(p, ctx),
    direction: launchDirection(yaw, spec.gravity),
    damage: scaledDamage(p, spec.damage, runtime),
    range: spec.range,
    profile: profileOf(spec),
    styleId: runtime.styleId,
  });
}

export function stepThrow(p: PlayerState, ctx: Ctx): PlayerState {
  const attack = p.attack;
  const runtime = p.action;
  if (!attack || runtime?.spec.kind !== 'projectile') return finishAction(p, ctx);
  const spec = runtime.spec;
  const { dt, input } = ctx;
  if (input.attackHoldStart && input.actionsAllowed && p.grounded && runtime.source === 'press') {
    const held = ctx.startHold(p, ctx);
    if (held) return held;
  }
  const elapsed = attack.elapsed + dt;
  const buffered = attack.bufferedAttack || (input.attack && runtime.source === 'press');
  let next: PlayerState = {
    ...p,
    stateTime: p.stateTime + dt,
    attack: { ...attack, elapsed, bufferedAttack: buffered },
    action: { ...runtime, elapsed },
  };
  let hits = runtime.hits;
  let nextAt = runtime.nextAt;
  while (hits < spec.count && elapsed >= nextAt) {
    spawn(next, ctx, spec, hits);
    hits++;
    nextAt += spec.interval;
  }
  next = {
    ...next,
    action: { ...runtime, elapsed, hits, nextAt },
    attackCounter: Math.max(next.attackCounter, attack.attackId + spec.count),
  };
  if (next.grounded) {
    const moved = moveGrounded(next, ctx, ZERO3);
    next = moved.next;
    if (moved.outcome === 'slide') return enterSlide(next, ctx);
    if (moved.outcome === 'ok') next = regen(next, ctx, true);
  } else {
    const moved = moveAirborne(next, ctx);
    next = moved.next;
    if (moved.outcome === 'slide') return enterSlide(next, ctx);
  }
  if (elapsed < spec.total) return next;
  ctx.events.push({ type: 'attackEnded', kind: runtime.kind });
  const chained = chainThen({ ...next, attack: null }, ctx);
  if (chained) return chained;
  if (buffered && input.actionsAllowed && runtime.source === 'press') {
    const again = ctx.startPress({ ...next, attack: null, action: null }, ctx);
    if (again) return again;
  }
  return finishAction(next, ctx);
}
