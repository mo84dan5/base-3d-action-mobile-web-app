import type { ActionSpec, BuffSpec, CostSpec, SelfEffectSpec } from '../../attackStyle/actionSpec';
import { findAttackStyle } from '../../attackStyle/attackStyleCatalog';
import { consumeStamina, isStaminaEmpty } from '../../stamina/stamina';
import type { ActiveBuff, PlayerState } from '../playerState';
import { withStamina, type Ctx, type StartActionOptions } from '../stepCore';
import { startArea } from './areaAction';
import { startCast } from './castAction';
import { startCharge } from './chargeAction';
import { startCombo } from './comboAction';
import { startGuard } from './guardAction';
import { startHitscan } from './hitscanAction';
import { startLunge } from './lungeAction';
import { startManeuver } from './maneuverAction';
import { startMultihit } from './multihitAction';
import { startPull } from './pullAction';
import { startThrow } from './throwAction';

// スタイル行動の開始(F11)。コストと条件を確かめ、機構ごとのエンジンへ振り分ける。

interface Payment {
  readonly ok: boolean;
  readonly staminaSpent: number;
}

function canPay(p: PlayerState, ctx: Ctx, cost: CostSpec | undefined): Payment {
  if (!cost) return { ok: true, staminaSpent: 0 };
  switch (cost.type) {
    case 'none':
      return { ok: true, staminaSpent: 0 };
    case 'stamina':
      // スタミナは 0 より大きければ発動(不足時は 0 まで)。F04
      return {
        ok: !isStaminaEmpty(p.stamina),
        staminaSpent: Math.min(p.stamina.value, cost.amount),
      };
    case 'allStamina':
      return { ok: !isStaminaEmpty(p.stamina), staminaSpent: p.stamina.value };
    case 'staminaPerSecond':
      return { ok: !isStaminaEmpty(p.stamina), staminaSpent: 0 };
    case 'energy':
      return { ok: ctx.input.energy + 1e-9 >= cost.amount, staminaSpent: 0 };
    case 'energyPerSecond':
      return { ok: ctx.input.energy > 0, staminaSpent: 0 };
    case 'hp':
      return { ok: p.hp > cost.amount, staminaSpent: 0 };
  }
}

function pay(p: PlayerState, ctx: Ctx, cost: CostSpec | undefined, payment: Payment): PlayerState {
  if (!cost) return p;
  switch (cost.type) {
    case 'stamina':
    case 'allStamina':
      return withStamina(
        p,
        ctx,
        consumeStamina(p.stamina, payment.staminaSpent, ctx.config.stamina),
      );
    case 'energy':
      ctx.events.push({ type: 'energySpent', amount: cost.amount });
      return p;
    case 'hp':
      ctx.events.push({ type: 'hpChanged', delta: -cost.amount });
      return { ...p, hp: p.hp - cost.amount };
    default:
      return p;
  }
}

function applyBuff(
  p: PlayerState,
  ctx: Ctx,
  spec: BuffSpec,
  opts: StartActionOptions,
): PlayerState | null {
  const buff: ActiveBuff = {
    effect: spec.effect,
    amount: spec.amount,
    duration: spec.duration,
    remaining: spec.duration,
    stacks: 0,
    maxStacks: spec.maxStacks ?? 0,
    beatSeconds: spec.beatSeconds ?? 0,
    beatTime: 0,
  };
  ctx.events.push({
    type: 'buffStarted',
    effect: spec.effect,
    amount: spec.amount,
    duration: spec.duration,
    radius: spec.radius,
    position: p.position,
  });
  const next: PlayerState = {
    ...p,
    buffs: [...p.buffs.filter((b) => b.effect !== spec.effect), buff],
  };
  if (!spec.then) return next;
  return ctx.startAction(next, ctx, spec.then, { source: opts.source }) ?? next;
}

function applySelfEffect(
  p: PlayerState,
  ctx: Ctx,
  spec: SelfEffectSpec,
  opts: StartActionOptions,
): PlayerState | null {
  if (p.hp < spec.minHp) {
    ctx.events.push({ type: 'actionRejected', reason: 'hp' });
    return null;
  }
  const hp = Math.min(ctx.config.combat.playerMaxHp, Math.max(1, p.hp + spec.hpDelta));
  ctx.events.push({ type: 'hpChanged', delta: hp - p.hp });
  const next = { ...p, hp };
  return (
    ctx.startAction(next, ctx, spec.then, { source: opts.source, then: opts.then ?? null }) ?? next
  );
}

function startRandom(
  p: PlayerState,
  ctx: Ctx,
  pool: readonly string[],
  opts: StartActionOptions,
): PlayerState | null {
  const index = Math.min(pool.length - 1, Math.floor(ctx.input.random * pool.length));
  const id = pool[index];
  const style = id === undefined ? null : findAttackStyle(id);
  if (!style) return null;
  ctx.events.push({ type: 'styleRolled', styleId: style.id });
  const spec = opts.source === 'press' ? style.press : style.hold.action;
  const cost = opts.source === 'press' ? style.cost.press : style.cost.hold;
  return startAction(p, ctx, spec, { ...opts, cost });
}

function dispatchStart(
  p: PlayerState,
  ctx: Ctx,
  spec: ActionSpec,
  opts: StartActionOptions,
): PlayerState | null {
  switch (spec.kind) {
    case 'combo':
      return startCombo(p, ctx, spec, opts);
    case 'lunge':
      return startLunge(p, ctx, spec, opts);
    case 'hitscan':
      return startHitscan(p, ctx, spec, opts);
    case 'charge':
      return startCharge(p, ctx, spec, opts);
    case 'area':
      return startArea(p, ctx, spec, opts);
    case 'multihit':
      return startMultihit(p, ctx, spec, opts);
    case 'projectile':
      return startThrow(p, ctx, spec, opts);
    case 'placed':
    case 'summon':
      return startCast(p, ctx, spec, opts);
    case 'guard':
      return startGuard(p, ctx, spec, opts);
    case 'movement':
      return startManeuver(p, ctx, spec, opts);
    case 'pull':
      return startPull(p, ctx, spec, opts);
    case 'buff':
      return applyBuff(p, ctx, spec, opts);
    case 'selfEffect':
      return applySelfEffect(p, ctx, spec, opts);
    case 'random':
      return startRandom(p, ctx, spec.pool, opts);
    case 'none':
      return null;
  }
}

/** 行動を開始する。条件・コストを満たさなければ null(状態は変えない)。 */
export function startAction(
  p: PlayerState,
  ctx: Ctx,
  spec: ActionSpec,
  opts: StartActionOptions,
): PlayerState | null {
  const payment = canPay(p, ctx, opts.cost);
  if (!payment.ok) {
    const energy = opts.cost?.type === 'energy' || opts.cost?.type === 'energyPerSecond';
    ctx.events.push({ type: 'actionRejected', reason: energy ? 'energy' : 'cost' });
    return null;
  }
  const mark = ctx.events.length;
  const started = dispatchStart(p, ctx, spec, { ...opts, staminaSpent: payment.staminaSpent });
  if (!started) {
    // 開始できなかった行動のイベント(発動通知)は取り消し、条件不成立を 1 つだけ知らせる
    const rejected = ctx.events
      .slice(mark)
      .filter((e) => e.type === 'actionRejected' || e.type === 'reloadStarted');
    ctx.events.splice(mark, ctx.events.length - mark, ...rejected);
    if (rejected.length === 0 && spec.kind !== 'random') {
      ctx.events.push({ type: 'actionRejected', reason: 'requirement' });
    }
    return null;
  }
  return pay(started, ctx, opts.cost, payment);
}

export function startPress(p: PlayerState, ctx: Ctx): PlayerState | null {
  if (!ctx.input.actionsAllowed) return null;
  const style = ctx.input.style;
  return startAction(p, ctx, style.press, { source: 'press', cost: style.cost.press });
}

export function startHold(p: PlayerState, ctx: Ctx): PlayerState | null {
  if (!ctx.input.actionsAllowed) return null;
  const style = ctx.input.style;
  return startAction(p, ctx, style.hold.action, { source: 'hold', cost: style.cost.hold });
}
