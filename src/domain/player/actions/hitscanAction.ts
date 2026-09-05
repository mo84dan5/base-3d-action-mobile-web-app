import type { HitscanSpec } from '../../attackStyle/actionSpec';
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
  newAttack,
  newRuntime,
  scaledDamage,
  shotOrigin,
  spreadDirections,
} from './runtime';

// A3 ヒットスキャン(F04 射撃・タメ打ち / F11)。射線は application が敵カプセルと交差判定する。

function withAmmo(p: PlayerState, spec: HitscanSpec): PlayerState {
  if (!spec.ammo) return p;
  if (p.ammo?.capacity === spec.ammo.capacity) return p;
  return {
    ...p,
    ammo: { remaining: spec.ammo.capacity, capacity: spec.ammo.capacity, reloadRemaining: 0 },
  };
}

export function startHitscan(
  p: PlayerState,
  ctx: Ctx,
  spec: HitscanSpec,
  opts: StartActionOptions,
): PlayerState | null {
  if (!p.grounded && !spec.airborne) return null;
  p = withAmmo(p, spec);
  if (spec.ammo && p.ammo) {
    if (p.ammo.reloadRemaining > 0) {
      ctx.events.push({ type: 'actionRejected', reason: 'ammo' });
      return null;
    }
    if (p.ammo.remaining <= 0) {
      ctx.events.push({ type: 'reloadStarted', seconds: spec.ammo.reloadTime });
      ctx.events.push({ type: 'actionRejected', reason: 'ammo' });
      return { ...p, ammo: { ...p.ammo, reloadRemaining: spec.ammo.reloadTime } };
    }
  }
  const targets = spec.target
    ? ctx.input.findTargets(spec.target, Math.max(1, spec.multiTarget ?? 1))
    : [];
  const yaw = targets[0]?.yaw ?? p.yaw;
  const kind = kindOf(spec.hitClass, spec.attackKind);
  const charged = opts.chargeRatio !== undefined;
  const { attackId, attack } = newAttack(p, 1);
  const styleId = ctx.input.style.id;
  ctx.events.push({ type: 'attackStarted', kind, stage: 1, action: 'hitscan', styleId });
  const damageBonus = (spec.damagePerStamina ?? 0) * (opts.staminaSpent ?? 0);
  return {
    ...enter(p, charged ? 'chargedShot' : 'shoot'),
    yaw,
    velocity: p.grounded ? ZERO3 : p.velocity,
    attackCounter: attackId,
    attack,
    strong: null,
    chargeRatio: opts.chargeRatio ?? 0,
    action: newRuntime(spec, kind, opts, styleId, {
      hits: 0,
      nextAt: spec.startup,
      // multiTarget の各射線の向きは targetId に入れられないので travelled にダメージ加算を持つ
      travelled: damageBonus,
    }),
  };
}

function fire(p: PlayerState, ctx: Ctx, spec: HitscanSpec): void {
  const runtime = p.action;
  if (!runtime || !p.attack) return;
  const damage = scaledDamage(p, spec.damage + runtime.travelled, runtime);
  const targets =
    spec.target && (spec.multiTarget ?? 1) > 1
      ? ctx.input.findTargets(spec.target, spec.multiTarget ?? 1)
      : [];
  const directions =
    targets.length > 1
      ? targets.map((t) => directionFromYaw(t.yaw))
      : spreadDirections(p.yaw, spec.rays, spec.spreadDeg);
  ctx.events.push({
    type: 'shotFired',
    kind: runtime.kind,
    attackId: p.attack.attackId,
    origin: shotOrigin(p, ctx),
    direction: directionFromYaw(p.yaw),
    directions,
    range: spec.range,
    damage,
    pierce: spec.pierce,
    beamWidth: spec.beamWidth,
    chargeRatio: runtime.chargeRatio,
    charged: p.name === 'chargedShot',
    profile: profileOf(spec),
  });
}

export function stepHitscan(p: PlayerState, ctx: Ctx): PlayerState {
  const attack = p.attack;
  const runtime = p.action;
  if (!attack || runtime?.spec.kind !== 'hitscan') return enter(p, 'idle');
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
  const shots = spec.burst ? spec.burst.count : 1;
  const interval = spec.burst ? spec.burst.interval : 0;
  let hits = runtime.hits;
  let nextAt = runtime.nextAt;
  while (hits < shots && elapsed >= nextAt) {
    fire(next, ctx, spec);
    hits++;
    nextAt += interval;
    if (spec.ammo && next.ammo) {
      const remaining = Math.max(0, next.ammo.remaining - 1);
      const reload = remaining === 0 ? spec.ammo.reloadTime : 0;
      if (reload > 0) ctx.events.push({ type: 'reloadStarted', seconds: reload });
      next = { ...next, ammo: { ...next.ammo, remaining, reloadRemaining: reload } };
      if (remaining === 0) hits = shots;
    }
  }
  next = { ...next, action: { ...runtime, elapsed, hits, nextAt } };
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
  return finishAction(
    { ...next, velocity: vec3(next.velocity.x, next.velocity.y, next.velocity.z) },
    ctx,
  );
}
