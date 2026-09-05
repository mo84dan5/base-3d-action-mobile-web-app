import type { ComboSpec, ComboStageSpec } from '../../attackStyle/actionSpec';
import {
  advanceDistanceThisStep,
  attackPhase,
  canCancelAttack,
  nextComboStage,
} from '../../combat/comboState';
import { ZERO3, directionFromYaw, scale, vec3 } from '../../math/vec3';
import { isStaminaEmpty } from '../../stamina/stamina';
import { findBuff, type PlayerState } from '../playerState';
import {
  enter,
  enterSlide,
  finishAction,
  groundSpeedFor,
  moveAirborne,
  moveGrounded,
  nextGroundState,
  regen,
  startDash,
  startFall,
  startJump,
  turnTowards,
  type Ctx,
  type StartActionOptions,
} from '../stepCore';
import { kindOf, profileOf } from './hitProfile';
import {
  chainThen,
  correctedYaw,
  emitVolumeHit,
  newAttack,
  newRuntime,
  scaledDamage,
} from './runtime';

// A1 近接コンボ(F04 通常攻撃 / F11)。地上は段送り、空中は airUses 回まで。

const RHYTHM_TOLERANCE = 0.1;

function stageOf(spec: ComboSpec, stage: number): ComboStageSpec {
  const s = spec.stages[stage - 1] ?? spec.stages[0];
  if (!s) throw new Error('combo without stages');
  return s;
}

function stageKind(spec: ComboSpec, stage: number) {
  return kindOf(spec.hitClass, spec.kinds?.[stage - 1]);
}

/** リズム(太鼓): 拍 ±0.1 秒で威力 ×amount、外すと半減。 */
function rhythmScale(p: PlayerState): number {
  const beat = findBuff(p, 'rhythm');
  if (!beat || beat.beatSeconds <= 0) return 1;
  const phase = beat.beatTime % beat.beatSeconds;
  const offBeat = Math.min(phase, beat.beatSeconds - phase);
  return offBeat <= RHYTHM_TOLERANCE ? beat.amount : 0.5;
}

export function startCombo(
  p: PlayerState,
  ctx: Ctx,
  spec: ComboSpec,
  opts: StartActionOptions,
): PlayerState | null {
  const styleId = ctx.input.style.id;
  const yaw = correctedYaw(p, ctx, spec.target);
  const damageScale = (opts.damageScale ?? 1) * rhythmScale(p);
  if (!p.grounded) {
    if (p.airAttackCount >= spec.airUses) return null;
    const { attackId, attack } = newAttack(p, 1);
    ctx.events.push({
      type: 'attackStarted',
      kind: 'airAttack',
      stage: 1,
      action: 'combo',
      styleId,
    });
    return {
      ...enter(p, 'airAttack'),
      yaw,
      attackCounter: attackId,
      airAttackUsed: true,
      airAttackCount: p.airAttackCount + 1,
      attack,
      strong: null,
      action: newRuntime(spec, 'airAttack', { ...opts, damageScale }, styleId),
    };
  }
  const stage = nextComboStage(p.lastAttackStage, p.comboWindowRemaining, spec.stages.length);
  const { attackId, attack } = newAttack(p, stage);
  const kind = stageKind(spec, stage);
  ctx.events.push({ type: 'attackStarted', kind, stage, action: 'combo', styleId });
  return {
    ...enter(p, 'attack'),
    yaw,
    velocity: ZERO3,
    attackCounter: attackId,
    attack,
    strong: null,
    action: newRuntime(spec, kind, { ...opts, damageScale }, styleId),
  };
}

export function stepCombo(p: PlayerState, ctx: Ctx): PlayerState {
  const attack = p.attack;
  const runtime = p.action;
  if (!attack || runtime?.spec.kind !== 'combo') return enter(p, 'idle');
  const spec = runtime.spec;
  const { config, dt, input } = ctx;
  const timing = stageOf(spec, attack.stage);
  const kind = stageKind(spec, attack.stage);
  if (input.attackHoldStart && input.actionsAllowed) {
    const held = ctx.startHold(p, ctx);
    if (held) {
      ctx.events.push({ type: 'attackEnded', kind });
      return held;
    }
  }
  if (canCancelAttack(attack.elapsed, timing)) {
    if (input.jump) return startJump(p, ctx);
    if (input.dash && !isStaminaEmpty(p.stamina)) return startDash(p, ctx);
  }
  const elapsed = attack.elapsed + dt;
  const buffered = attack.bufferedAttack || input.attack;
  let next: PlayerState = {
    ...p,
    stateTime: p.stateTime + dt,
    attack: { ...attack, elapsed, bufferedAttack: buffered },
    action: { ...runtime, elapsed },
  };
  if (attackPhase(elapsed, timing) === 'active') {
    emitVolumeHit(
      next,
      ctx,
      spec.shape,
      scaledDamage(p, timing.damage, runtime),
      kind,
      profileOf(spec),
    );
  }
  let velocity = ZERO3;
  if (spec.keepMoving && ctx.magnitude > 0) {
    velocity = scale(
      ctx.moveDir,
      Math.min(config.movement.walkSpeed, groundSpeedFor(ctx.magnitude, config)),
    );
    next = turnTowards(next, ctx.moveDir, config.movement.turnSpeedDeg, dt);
  } else {
    const advance = advanceDistanceThisStep(attack.elapsed, dt, timing);
    if (advance > 0 && dt > 0) velocity = scale(directionFromYaw(p.yaw), advance / dt);
  }
  const moved = moveGrounded(next, ctx, velocity);
  next = moved.next;
  if (moved.outcome === 'fell') {
    ctx.events.push({ type: 'attackEnded', kind });
    return startFall(next, ctx, false);
  }
  if (moved.outcome === 'slide') {
    ctx.events.push({ type: 'attackEnded', kind });
    return enterSlide(next, ctx);
  }
  next = regen(next, ctx, true);
  if (elapsed < timing.total) return next;
  ctx.events.push({ type: 'attackEnded', kind });
  const ended: PlayerState = {
    ...next,
    attack: null,
    strong: null,
    lastAttackStage: attack.stage,
    comboWindowRemaining: spec.comboWindow,
  };
  const chained = chainThen(ended, ctx);
  if (chained) return chained;
  if (buffered && input.actionsAllowed && runtime.then === null) {
    const again = ctx.startAction(ended, ctx, spec, {
      source: runtime.source,
      cost: runtime.source === 'press' ? input.style.cost.press : input.style.cost.hold,
    });
    if (again) return again;
  }
  return enter({ ...ended, action: null }, 'idle');
}

export function stepAirCombo(p: PlayerState, ctx: Ctx): PlayerState {
  const attack = p.attack;
  const runtime = p.action;
  if (!attack || runtime?.spec.kind !== 'combo') return startFall(p, ctx, false);
  const spec = runtime.spec;
  const { dt } = ctx;
  const timing = stageOf(spec, 1);
  const elapsed = attack.elapsed + dt;
  let next: PlayerState = {
    ...p,
    stateTime: p.stateTime + dt,
    attack: { ...attack, elapsed },
    action: { ...runtime, elapsed },
  };
  if (attackPhase(elapsed, timing) === 'active') {
    emitVolumeHit(
      next,
      ctx,
      spec.shape,
      scaledDamage(p, timing.damage, runtime),
      'airAttack',
      profileOf(spec),
    );
  }
  if (next.grounded) {
    next = moveGrounded(next, ctx, ZERO3).next;
  } else {
    const moved = moveAirborne(next, ctx);
    next = moved.next;
    if (moved.outcome === 'slide') {
      ctx.events.push({ type: 'attackEnded', kind: 'airAttack' });
      return enterSlide(next, ctx);
    }
  }
  if (elapsed < timing.total) return next;
  ctx.events.push({ type: 'attackEnded', kind: 'airAttack' });
  const cleared = { ...next, attack: null, action: null, strong: null };
  if (cleared.grounded) return enter(cleared, nextGroundState(cleared, ctx));
  return finishAction(
    { ...cleared, velocity: vec3(cleared.velocity.x, cleared.velocity.y, cleared.velocity.z) },
    ctx,
  );
}
