import type { ActionSpec, ChargeSpec, HitShape } from '../../attackStyle/actionSpec';
import { vec3 } from '../../math/vec3';
import { moveVelocityTowards } from '../playerPhysics';
import type { PlayerState } from '../playerState';
import {
  enter,
  enterSlide,
  groundSpeedFor,
  moveGrounded,
  regen,
  startFall,
  turnTowards,
  type Ctx,
  type StartActionOptions,
} from '../stepCore';
import { newRuntime } from './runtime';

// A4 タメ(F04 タメ打ち / F11)。長押しの間ためて、離した瞬間に release の行動を倍率付きで始める。

function lerp(range: readonly [number, number] | undefined, base: number, t: number): number {
  if (!range) return base;
  return range[0] + (range[1] - range[0]) * t;
}

function scaleShape(shape: HitShape, k: number): HitShape {
  switch (shape.type) {
    case 'sphere':
      return { ...shape, radius: shape.radius * k };
    case 'fan':
    case 'ring':
      return { ...shape, radius: shape.radius * k };
    case 'line':
      return { ...shape, length: shape.length * k };
  }
}

/** タメ率 t で release の仕様を倍率付きに複製する。 */
export function scaledRelease(spec: ChargeSpec, t: number, chargeTime: number): ActionSpec {
  const r = spec.release;
  let damage = lerp(spec.scale.damage, 'damage' in r ? r.damage : 0, t);
  if (spec.tiers) {
    const reached = spec.tiers.filter((tier) => chargeTime + 1e-9 >= tier.seconds);
    const top = reached[reached.length - 1];
    damage = top ? top.damage : spec.scale.damage ? spec.scale.damage[0] : damage;
  }
  const radiusK = spec.scale.radius ? lerp(spec.scale.radius, 1, t) / spec.scale.radius[1] : 1;
  switch (r.kind) {
    case 'hitscan':
      return { ...r, damage, range: lerp(spec.scale.range, r.range, t) };
    case 'area':
      return { ...r, damage, shape: scaleShape(r.shape, radiusK) };
    case 'lunge': {
      const distance = spec.scale.distance
        ? lerp(spec.scale.distance, 0, t)
        : r.lungeSpeed * r.lungeMaxTime;
      return { ...r, damage, lungeMaxTime: distance / r.lungeSpeed };
    }
    case 'projectile': {
      const explosion = r.explosion
        ? {
            ...r.explosion,
            radius: lerp(spec.scale.radius, r.explosion.radius, t),
            damage: spec.scale.damage ? damage : r.explosion.damage,
          }
        : undefined;
      return {
        ...r,
        damage: spec.scale.damage && !r.explosion ? damage : r.damage,
        range: lerp(spec.scale.range, r.range, t),
        ...(explosion ? { explosion } : {}),
      };
    }
    default:
      return r;
  }
}

export function startCharge(
  p: PlayerState,
  ctx: Ctx,
  spec: ChargeSpec,
  opts: StartActionOptions,
): PlayerState | null {
  if (!p.grounded) return null;
  ctx.events.push({ type: 'chargeStarted' });
  return {
    ...enter(p, 'charge'),
    attack: null,
    strong: null,
    chargeTime: 0,
    velocity: vec3(p.velocity.x, 0, p.velocity.z),
    action: newRuntime(spec, 'chargedShot', opts, ctx.input.style.id),
  };
}

export function stepCharge(p: PlayerState, ctx: Ctx): PlayerState {
  const runtime = p.action;
  if (runtime?.spec.kind !== 'charge') return enter(p, 'idle');
  const spec = runtime.spec;
  const { config, dt, input } = ctx;
  if (input.attackHoldEnd) {
    const ratio = Math.min(1, p.chargeTime / spec.maxTime);
    const release = scaledRelease(spec, ratio, p.chargeTime);
    const released = ctx.startAction(
      { ...p, chargeRatio: ratio, chargeTime: 0, action: null },
      ctx,
      release,
      {
        source: 'hold',
        chargeRatio: ratio,
        then: runtime.then,
      },
    );
    if (released) return released;
    return { ...enter(p, 'idle'), chargeTime: 0, action: null };
  }
  const speed = Math.min(spec.moveSpeed, groundSpeedFor(ctx.magnitude, config));
  const target = { x: ctx.moveDir.x * speed, y: 0, z: ctx.moveDir.z * speed };
  const velocity = moveVelocityTowards(
    vec3(p.velocity.x, 0, p.velocity.z),
    target,
    config.movement.acceleration * dt,
  );
  let next = turnTowards(
    { ...p, velocity, chargeTime: p.chargeTime + dt, stateTime: p.stateTime + dt },
    ctx.moveDir,
    config.movement.turnSpeedDeg,
    dt,
  );
  const moved = moveGrounded(next, ctx, next.velocity);
  next = { ...moved.next, velocity: moved.outcome === 'ok' ? velocity : moved.next.velocity };
  if (moved.outcome !== 'ok') {
    ctx.events.push({ type: 'chargeCancelled' });
    next = { ...next, chargeTime: 0, action: null };
    return moved.outcome === 'fell' ? startFall(next, ctx, true) : enterSlide(next, ctx);
  }
  return regen(next, ctx, true);
}
