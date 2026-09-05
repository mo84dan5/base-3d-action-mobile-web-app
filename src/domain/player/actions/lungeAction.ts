import type { LungeSpec } from '../../attackStyle/actionSpec';
import { attackPhase } from '../../combat/comboState';
import { ZERO3, directionFromYaw, scale } from '../../math/vec3';
import type { PlayerState } from '../playerState';
import {
  enter,
  enterSlide,
  moveGrounded,
  regen,
  startFall,
  type Ctx,
  type StartActionOptions,
} from '../stepCore';
import { kindOf, profileOf } from './hitProfile';
import { chainThen, emitVolumeHit, newAttack, newRuntime, scaledDamage } from './runtime';

// A2 踏み込み・突進(F04 接近強攻撃 / F11)。目標の手前 stopDistance まで踏み込み、振る。

export function startLunge(
  p: PlayerState,
  ctx: Ctx,
  spec: LungeSpec,
  opts: StartActionOptions,
): PlayerState | null {
  if (!p.grounded) return null;
  const target = spec.target ? ctx.input.findTarget(spec.target) : null;
  const yaw = target ? target.yaw : p.yaw;
  const maxLunge = spec.lungeSpeed * spec.lungeMaxTime;
  const lungeLimit = target
    ? Math.min(maxLunge, Math.max(0, target.distance - spec.stopDistance))
    : maxLunge;
  const dir = directionFromYaw(yaw);
  const kind = kindOf(spec.hitClass, spec.attackKind);
  const { attackId, attack } = newAttack(p, 1);
  ctx.events.push({
    type: 'attackStarted',
    kind,
    stage: 1,
    action: 'lunge',
    styleId: ctx.input.style.id,
  });
  const phase = lungeLimit <= 1e-3 ? 'swing' : 'lunge';
  if (phase === 'lunge') ctx.events.push({ type: 'lungeStarted', direction: dir });
  return {
    ...enter(p, 'strongAttack'),
    yaw,
    velocity: ZERO3,
    attackCounter: attackId,
    attack,
    strong: { phase, lungeDir: dir, lungeTime: 0, lungeTravelled: 0, lungeLimit },
    action: newRuntime(spec, kind, opts, ctx.input.style.id),
    lastAttackStage: 0,
    comboWindowRemaining: 0,
  };
}

function endLunge(p: PlayerState, ctx: Ctx): PlayerState {
  const chained = chainThen({ ...p, attack: null, strong: null }, ctx);
  if (chained) return chained;
  return enter({ ...p, attack: null, strong: null, action: null }, 'idle');
}

export function stepLunge(p: PlayerState, ctx: Ctx): PlayerState {
  const strong = p.strong;
  const attack = p.attack;
  const runtime = p.action;
  if (!strong || !attack || runtime?.spec.kind !== 'lunge') return enter(p, 'idle');
  const spec = runtime.spec;
  const { dt } = ctx;
  const kind = runtime.kind;
  const damage = scaledDamage(p, spec.damage, runtime);
  if (strong.phase === 'lunge') {
    // 最後のステップは残り距離に合わせて速度を落とし、目標の手前 stopDistance を越えないようにする
    const remaining = Math.max(0, strong.lungeLimit - strong.lungeTravelled);
    const stepDistance = Math.min(spec.lungeSpeed * dt, remaining);
    const velocity = scale(strong.lungeDir, dt > 0 ? stepDistance / dt : 0);
    const moved = moveGrounded(p, ctx, velocity);
    const travelled = strong.lungeTravelled + stepDistance;
    const lungeTime = strong.lungeTime + dt;
    let next: PlayerState = {
      ...moved.next,
      stateTime: p.stateTime + dt,
      strong: { ...strong, lungeTime, lungeTravelled: travelled },
      action: { ...runtime, elapsed: runtime.elapsed + dt },
    };
    if (spec.hitWhileMoving) emitVolumeHit(next, ctx, spec.shape, damage, kind, profileOf(spec));
    if (moved.outcome === 'fell') {
      ctx.events.push({ type: 'attackEnded', kind });
      return startFall({ ...next, strong: null, attack: null, action: null }, ctx, false);
    }
    if (moved.outcome === 'slide') {
      return enterSlide({ ...next, strong: null, attack: null, action: null }, ctx);
    }
    if (
      lungeTime + 1e-9 >= spec.lungeMaxTime ||
      travelled + 1e-9 >= strong.lungeLimit ||
      moved.walls > 0
    ) {
      const skipActive = spec.hitWhileMoving ? spec.startup + spec.active : 0;
      next = {
        ...next,
        strong: { ...strong, lungeTime, lungeTravelled: travelled, phase: 'swing' },
        attack: { ...attack, elapsed: Math.max(attack.elapsed, skipActive) },
      };
    }
    return next;
  }
  const elapsed = attack.elapsed + dt;
  let next: PlayerState = {
    ...p,
    stateTime: p.stateTime + dt,
    attack: { ...attack, elapsed },
    action: { ...runtime, elapsed: runtime.elapsed + dt },
  };
  if (!spec.hitWhileMoving && attackPhase(elapsed, spec) === 'active') {
    emitVolumeHit(next, ctx, spec.shape, damage, kind, profileOf(spec));
  }
  const moved = moveGrounded(next, ctx, ZERO3);
  next = moved.next;
  if (moved.outcome === 'fell') {
    ctx.events.push({ type: 'attackEnded', kind });
    return startFall({ ...next, strong: null, attack: null, action: null }, ctx, false);
  }
  next = regen(next, ctx, true);
  if (elapsed < spec.total) return next;
  ctx.events.push({ type: 'attackEnded', kind });
  return endLunge(next, ctx);
}
