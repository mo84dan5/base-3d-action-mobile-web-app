import type { AreaSpec } from '../../attackStyle/actionSpec';
import { attackPhase } from '../../combat/comboState';
import { ZERO3, scale, vec3 } from '../../math/vec3';
import type { PlayerState } from '../playerState';
import {
  enter,
  enterSlide,
  finishAction,
  groundSpeedFor,
  moveAirborne,
  moveGrounded,
  regen,
  startFall,
  turnTowards,
  type Ctx,
  type StartActionOptions,
} from '../stepCore';
import { kindOf, profileOf } from './hitProfile';
import { chainThen, emitVolumeHit, newAttack, newRuntime, scaledDamage } from './runtime';

// A5 範囲攻撃(F11)。球・扇・リング・直線の体積で、発生〜持続の間にヒットさせる。
// jumpHeight があれば跳んで着地してから発動(地割り)。expandSeconds があればリングが広がる(衝撃波)。

export function jumpSpeedForHeight(height: number, gravity: number): number {
  return Math.sqrt(2 * gravity * Math.max(0, height));
}

export function startArea(
  p: PlayerState,
  ctx: Ctx,
  spec: AreaSpec,
  opts: StartActionOptions,
): PlayerState | null {
  if (!p.grounded && !opts.then && opts.source !== 'hold') return null;
  const kind = kindOf(spec.hitClass, spec.attackKind);
  const { attackId, attack } = newAttack(p, 1);
  const styleId = ctx.input.style.id;
  ctx.events.push({ type: 'attackStarted', kind, stage: 1, action: 'area', styleId });
  const jumping = (spec.jumpHeight ?? 0) > 0 && p.grounded;
  return {
    ...enter(p, 'area'),
    velocity: jumping
      ? vec3(0, jumpSpeedForHeight(spec.jumpHeight ?? 0, ctx.config.physics.gravity), 0)
      : p.grounded
        ? ZERO3
        : p.velocity,
    grounded: jumping ? false : p.grounded,
    attackCounter: attackId,
    attack,
    strong: null,
    action: newRuntime(spec, kind, opts, styleId, { phase: jumping ? 'jump' : 'strike' }),
  };
}

export function stepArea(p: PlayerState, ctx: Ctx): PlayerState {
  const attack = p.attack;
  const runtime = p.action;
  if (!attack || runtime?.spec.kind !== 'area') return finishAction(p, ctx);
  const spec = runtime.spec;
  const { config, dt } = ctx;
  if (runtime.phase === 'jump' || !p.grounded) {
    const moved = moveAirborne({ ...p, stateTime: p.stateTime + dt }, ctx);
    if (moved.outcome === 'slide') return enterSlide(moved.next, ctx);
    if (moved.outcome === 'air') return moved.next;
    return {
      ...moved.next,
      action: { ...runtime, phase: 'strike', elapsed: 0 },
      attack: { ...attack, elapsed: 0 },
    };
  }
  const elapsed = attack.elapsed + dt;
  let next: PlayerState = {
    ...p,
    stateTime: p.stateTime + dt,
    attack: { ...attack, elapsed },
    action: { ...runtime, elapsed },
  };
  if (attackPhase(elapsed, spec) === 'active') {
    const expand = spec.expandSeconds
      ? Math.min(1, Math.max(0.05, (elapsed - spec.startup) / spec.expandSeconds))
      : 1;
    if (spec.selfDamage && !runtime.fired) {
      ctx.events.push({ type: 'hpChanged', delta: -spec.selfDamage });
      next = {
        ...next,
        hp: Math.max(1, next.hp - spec.selfDamage),
        action: { ...next.action, fired: true } as PlayerState['action'],
      };
    }
    emitVolumeHit(
      next,
      ctx,
      spec.shape,
      scaledDamage(p, spec.damage, runtime),
      runtime.kind,
      profileOf(spec),
      expand,
    );
  }
  let velocity = ZERO3;
  if (spec.movement !== 'stop' && ctx.magnitude > 0) {
    const cap = spec.movement === 'walk' ? config.movement.walkSpeed : config.movement.runSpeed;
    velocity = scale(ctx.moveDir, Math.min(cap, groundSpeedFor(ctx.magnitude, config)));
    next = turnTowards(next, ctx.moveDir, config.movement.turnSpeedDeg, dt);
  }
  const moved = moveGrounded(next, ctx, velocity);
  next = moved.next;
  if (moved.outcome === 'fell') {
    ctx.events.push({ type: 'attackEnded', kind: runtime.kind });
    return startFall(next, ctx, false);
  }
  if (moved.outcome === 'slide') return enterSlide(next, ctx);
  next = regen(next, ctx, true);
  if (elapsed < spec.total) return next;
  ctx.events.push({ type: 'attackEnded', kind: runtime.kind });
  const chained = chainThen({ ...next, attack: null }, ctx);
  if (chained) return chained;
  return finishAction(next, ctx);
}
