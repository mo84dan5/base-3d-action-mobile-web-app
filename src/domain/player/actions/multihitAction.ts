import type { MultihitSpec } from '../../attackStyle/actionSpec';
import { ZERO3, directionFromYaw, scale } from '../../math/vec3';
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
  type Ctx,
  type StartActionOptions,
} from '../stepCore';
import { profileOf } from './hitProfile';
import {
  chainThen,
  emitVolumeHit,
  newAttack,
  newRuntime,
  nextAttackId,
  scaledDamage,
  shotOrigin,
  spreadDirections,
  tickHoldCost,
} from './runtime';

// N2 多段ヒット(F11)。間隔ごとに新しい攻撃 ID で判定(または射線)を出す。whileHeld は離すまで続く。

const ACCELERATE_SECONDS = 2.0;

export function startMultihit(
  p: PlayerState,
  ctx: Ctx,
  spec: MultihitSpec,
  opts: StartActionOptions,
): PlayerState | null {
  if (!p.grounded && !spec.ranged) return null;
  const yaw = spec.ranged
    ? (ctx.input.findTarget({ halfAngleDeg: 15, range: spec.ranged.range })?.yaw ?? p.yaw)
    : p.yaw;
  const kind = spec.hitClass;
  const { attackId, attack } = newAttack(p, 1);
  const styleId = ctx.input.style.id;
  ctx.events.push({ type: 'attackStarted', kind, stage: 1, action: 'multihit', styleId });
  return {
    ...enter(p, 'multihit'),
    yaw,
    velocity: ZERO3,
    attackCounter: attackId,
    attack,
    strong: null,
    action: newRuntime(spec, kind, opts, styleId, { nextAt: 0 }),
  };
}

function intervalAt(spec: MultihitSpec, elapsed: number): number {
  if (spec.accelerateTo === undefined) return spec.interval;
  const t = Math.min(1, elapsed / ACCELERATE_SECONDS);
  return spec.interval + (spec.accelerateTo - spec.interval) * t;
}

function tick(p: PlayerState, ctx: Ctx, spec: MultihitSpec, index: number): PlayerState {
  const next = nextAttackId(p);
  const runtime = next.action;
  if (!runtime || !next.attack) return next;
  const damage = scaledDamage(p, spec.damage, runtime);
  if (spec.ranged) {
    const yaw =
      spec.shape.type === 'fan' && spec.count > 1
        ? next.yaw -
          (spec.shape.angleDeg * Math.PI) / 360 +
          ((spec.shape.angleDeg * Math.PI) / 180) * (index / Math.max(1, spec.count - 1))
        : next.yaw;
    ctx.events.push({
      type: 'shotFired',
      kind: runtime.kind,
      attackId: next.attack.attackId,
      origin: shotOrigin(next, ctx),
      direction: directionFromYaw(yaw),
      directions: spreadDirections(yaw, 1, 0),
      range: spec.ranged.range,
      damage,
      pierce: spec.ranged.pierce,
      beamWidth: spec.ranged.beamWidth,
      chargeRatio: 0,
      charged: false,
      profile: profileOf(spec),
    });
    return next;
  }
  emitVolumeHit(next, ctx, spec.shape, damage, runtime.kind, profileOf(spec));
  return next;
}

export function stepMultihit(p: PlayerState, ctx: Ctx): PlayerState {
  const runtime = p.action;
  if (runtime?.spec.kind !== 'multihit' || !p.attack) return finishAction(p, ctx);
  const spec = runtime.spec;
  const { config, dt, input } = ctx;
  const elapsed = runtime.elapsed + dt;
  const released = spec.whileHeld && input.attackHoldEnd && runtime.source === 'hold';
  const paid = tickHoldCost(p, ctx);
  let next: PlayerState = {
    ...(paid ?? p),
    stateTime: p.stateTime + dt,
    action: { ...runtime, elapsed },
  };
  let hits = runtime.hits;
  let nextAt = runtime.nextAt;
  while (!released && hits < spec.count && elapsed >= nextAt) {
    next = tick(next, ctx, spec, hits);
    hits++;
    nextAt += intervalAt(spec, elapsed);
  }
  next = { ...next, action: next.action ? { ...next.action, hits, nextAt } : null };
  let velocity = ZERO3;
  if (spec.moveSpeed > 0 && ctx.magnitude > 0) {
    velocity = scale(ctx.moveDir, Math.min(spec.moveSpeed, groundSpeedFor(ctx.magnitude, config)));
    next = turnTowards(next, ctx.moveDir, config.movement.turnSpeedDeg, dt);
  }
  if (next.grounded) {
    const moved = moveGrounded(next, ctx, velocity);
    next = moved.next;
    if (moved.outcome === 'fell') {
      ctx.events.push({ type: 'attackEnded', kind: runtime.kind });
      return startFall(next, ctx, false);
    }
    if (moved.outcome === 'slide') return enterSlide(next, ctx);
    next = regen(next, ctx, false);
  }
  const done =
    released ||
    paid === null ||
    (!spec.whileHeld && hits >= spec.count) ||
    elapsed + 1e-9 >= spec.maxDuration ||
    (spec.whileHeld && hits >= spec.count);
  if (!done) return next;
  ctx.events.push({ type: 'attackEnded', kind: runtime.kind });
  const chained = chainThen({ ...next, attack: null }, ctx);
  if (chained) return chained;
  return finishAction(next, ctx);
}
