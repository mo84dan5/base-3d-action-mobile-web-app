import type { PlacedSpec, SummonSpec } from '../../attackStyle/actionSpec';
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
import { chainThen, newAttack, newRuntime } from './runtime';

// N3 設置物 / N4 召喚体(F11)。短い詠唱の後に application へ設置・召喚・命令を通知する。
// command 付きの仕様(長押し)は設置せず命令だけを出す。

const CAST_STARTUP = 0.15;
const CAST_TOTAL = 0.4;

export function startCast(
  p: PlayerState,
  ctx: Ctx,
  spec: PlacedSpec | SummonSpec,
  opts: StartActionOptions,
): PlayerState | null {
  if (!p.grounded) return null;
  const kind = kindOf(spec.hitClass);
  const { attackId, attack } = newAttack(p, 1);
  const styleId = ctx.input.style.id;
  ctx.events.push({ type: 'attackStarted', kind, stage: 1, action: spec.kind, styleId });
  if (spec.command) {
    if (spec.kind === 'placed') {
      ctx.events.push({
        type: 'placedCommand',
        command: spec.command,
        object: spec.object,
        spec,
        profile: profileOf(spec),
      });
    } else {
      ctx.events.push({
        type: 'summonCommand',
        command: spec.command,
        entity: spec.entity,
        spec,
        profile: profileOf(spec),
      });
    }
  }
  return {
    ...enter(p, 'cast'),
    velocity: ZERO3,
    attackCounter: attackId + (spec.kind === 'placed' ? spec.count : 1),
    attack,
    strong: null,
    action: newRuntime(spec, kind, opts, styleId, { fired: spec.command !== undefined }),
  };
}

function place(p: PlayerState, ctx: Ctx, spec: PlacedSpec | SummonSpec): void {
  const runtime = p.action;
  if (!runtime || !p.attack) return;
  if (spec.kind === 'summon') {
    ctx.events.push({
      type: 'summoned',
      attackId: p.attack.attackId,
      spec,
      kind: runtime.kind,
      position: p.position,
      yaw: p.yaw,
      profile: profileOf(spec),
      styleId: runtime.styleId,
    });
    return;
  }
  const half = (spec.spreadDeg * Math.PI) / 360;
  for (let i = 0; i < spec.count; i++) {
    const t = spec.count <= 1 ? 0.5 : i / (spec.count - 1);
    const yaw = spec.count <= 1 ? p.yaw : p.yaw - half + 2 * half * t;
    ctx.events.push({
      type: 'objectPlaced',
      attackId: p.attack.attackId + i,
      spec,
      kind: runtime.kind,
      position: add(p.position, scale(directionFromYaw(yaw), spec.forward)),
      yaw,
      profile: profileOf(spec),
      styleId: runtime.styleId,
    });
  }
}

export function stepCast(p: PlayerState, ctx: Ctx): PlayerState {
  const attack = p.attack;
  const runtime = p.action;
  if (!attack || (runtime?.spec.kind !== 'placed' && runtime?.spec.kind !== 'summon'))
    return finishAction(p, ctx);
  const spec = runtime.spec;
  const { dt } = ctx;
  const elapsed = attack.elapsed + dt;
  let fired = runtime.fired;
  let next: PlayerState = {
    ...p,
    stateTime: p.stateTime + dt,
    attack: { ...attack, elapsed },
    action: { ...runtime, elapsed },
  };
  if (!fired && elapsed >= CAST_STARTUP) {
    place(next, ctx, spec);
    fired = true;
    next = { ...next, action: { ...runtime, elapsed, fired } };
  }
  const moved = moveGrounded(next, ctx, ZERO3);
  next = moved.next;
  if (moved.outcome === 'fell') return startFall(next, ctx, false);
  if (moved.outcome === 'slide') return enterSlide(next, ctx);
  next = regen(next, ctx, true);
  if (elapsed < CAST_TOTAL) return next;
  ctx.events.push({ type: 'attackEnded', kind: runtime.kind });
  const chained = chainThen({ ...next, attack: null }, ctx);
  if (chained) return chained;
  return finishAction(next, ctx);
}
