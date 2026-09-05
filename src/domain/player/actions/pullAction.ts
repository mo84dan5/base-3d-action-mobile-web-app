import type { PullSpec } from '../../attackStyle/actionSpec';
import { ZERO3, add, directionFromYaw, scale } from '../../math/vec3';
import type { PlayerState } from '../playerState';
import {
  enter,
  enterSlide,
  finishAction,
  moveGrounded,
  regen,
  startFall,
  type Ctx,
  type StartActionOptions,
} from '../stepCore';
import { kindOf, profileOf } from './hitProfile';
import { chainThen, newAttack, newRuntime, scaledDamage } from './runtime';

// N9 引き寄せ / 拘束(F11)。円錐内の敵を手元へ引き寄せ(reel)、拘束(hold)してから離し、then を始める。
// 敵の位置は application が pullTick に従って動かす。

const PULL_CONE_DEG = 45;
const WHIFF_SECONDS = 0.3;
const GRAB_FORWARD = 1.0;

export function startPull(
  p: PlayerState,
  ctx: Ctx,
  spec: PullSpec,
  opts: StartActionOptions,
): PlayerState | null {
  if (!p.grounded) return null;
  const target = ctx.input.findTarget({ halfAngleDeg: PULL_CONE_DEG, range: spec.reach });
  const { attackId, attack } = newAttack(p, 1);
  const kind = kindOf(spec.hitClass);
  ctx.events.push({
    type: 'attackStarted',
    kind,
    stage: 1,
    action: 'pull',
    styleId: ctx.input.style.id,
  });
  const reelSeconds =
    target && spec.speed > 0 ? Math.max(0, target.distance - spec.stopDistance) / spec.speed : 0;
  return {
    ...enter(p, 'pull'),
    yaw: target ? target.yaw : p.yaw,
    velocity: ZERO3,
    attackCounter: attackId,
    attack,
    strong: null,
    invincibleRemaining: target
      ? Math.max(p.invincibleRemaining, spec.holdSeconds + reelSeconds)
      : p.invincibleRemaining,
    action: newRuntime(spec, kind, opts, ctx.input.style.id, {
      phase: target ? 'reel' : 'whiff',
      targetId: target?.id ?? null,
      nextAt: reelSeconds,
    }),
  };
}

export function stepPull(p: PlayerState, ctx: Ctx): PlayerState {
  const runtime = p.action;
  if (runtime?.spec.kind !== 'pull' || !p.attack) return finishAction(p, ctx);
  const spec = runtime.spec;
  const { dt } = ctx;
  const elapsed = runtime.elapsed + dt;
  let next: PlayerState = { ...p, stateTime: p.stateTime + dt, action: { ...runtime, elapsed } };
  const moved = moveGrounded(next, ctx, ZERO3);
  next = regen(moved.next, ctx, false);
  if (moved.outcome === 'fell') return startFall(next, ctx, false);
  if (moved.outcome === 'slide') return enterSlide(next, ctx);
  if (runtime.phase === 'whiff') {
    if (elapsed < WHIFF_SECONDS) return next;
    ctx.events.push({ type: 'attackEnded', kind: runtime.kind });
    return finishAction(next, ctx);
  }
  const targetId = runtime.targetId;
  if (targetId === null) return finishAction(next, ctx);
  const front = add(
    next.position,
    scale(directionFromYaw(next.yaw), Math.max(spec.stopDistance, GRAB_FORWARD)),
  );
  if (runtime.phase === 'reel') {
    ctx.events.push({
      type: 'pullTick',
      targetId,
      towards: front,
      speed: spec.speed,
      stopDistance: spec.stopDistance,
      hold: false,
    });
    if (elapsed < runtime.nextAt) return next;
    return { ...next, action: { ...runtime, elapsed: 0, phase: 'hold' } };
  }
  ctx.events.push({
    type: 'pullTick',
    targetId,
    towards: front,
    speed: 0,
    stopDistance: spec.stopDistance,
    hold: true,
  });
  if (elapsed < spec.holdSeconds) return next;
  const then = runtime.then;
  const throwArea =
    then?.kind === 'area' && then.shape.type === 'sphere' && then.shape.forward > 0
      ? then.shape
      : null;
  ctx.events.push({
    type: 'pullReleased',
    targetId,
    damage: scaledDamage(p, spec.damage, runtime),
    kind: runtime.kind,
    profile: profileOf(spec),
    throwDirection: throwArea ? directionFromYaw(next.yaw) : null,
    throwDistance: throwArea ? throwArea.forward : 0,
    attackId: p.attack.attackId,
  });
  ctx.events.push({ type: 'attackEnded', kind: runtime.kind });
  const chained = chainThen({ ...next, attack: null }, ctx);
  if (chained) return chained;
  return finishAction(next, ctx);
}
