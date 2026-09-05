import type { ActionSpec, HitShape, TargetCone } from '../../attackStyle/actionSpec';
import type { HitProfile } from '../../combat/damage';
import { volumeExtent, volumeFromShape, type HitVolume } from '../../combat/hitVolume';
import type { AttackKind } from '../../hitReaction/hitTables';
import { ZERO3, add, directionFromYaw, vec3, type Vec3 } from '../../math/vec3';
import { drainStamina, isStaminaEmpty } from '../../stamina/stamina';
import { withStamina, type Ctx, type StartActionOptions } from '../stepCore';
import {
  damageMultiplier,
  type ActionRuntime,
  type AttackData,
  type PlayerState,
} from '../playerState';

// スタイル行動エンジンの共通部品(F11)。

export function newRuntime(
  spec: ActionSpec,
  kind: AttackKind,
  opts: StartActionOptions,
  styleId: string,
  extra: Partial<ActionRuntime> = {},
): ActionRuntime {
  return {
    spec,
    kind,
    source: opts.source,
    styleId,
    then: opts.then ?? null,
    chargeRatio: opts.chargeRatio ?? 0,
    radiusScale: opts.radiusScale ?? 1,
    damageScale: opts.damageScale ?? 1,
    elapsed: 0,
    phase: '',
    hits: 0,
    nextAt: 0,
    dir: ZERO3,
    travelled: 0,
    targetId: null,
    fired: false,
    succeeded: false,
    ...extra,
  };
}

export function newAttack(p: PlayerState, stage = 1): { attackId: number; attack: AttackData } {
  const attackId = p.attackCounter + 1;
  return {
    attackId,
    attack: { stage, elapsed: 0, attackId, hitTargets: [], bufferedAttack: false },
  };
}

/** 攻撃 ID を進めて新しいヒット判定を始める(多段ヒットの各ティック)。 */
export function nextAttackId(p: PlayerState): PlayerState {
  const { attackId, attack } = newAttack(p);
  return { ...p, attackCounter: attackId, attack };
}

/** ターゲット補正: 円錐内の最近接敵の方向。無ければ現在の向き。 */
export function correctedYaw(p: PlayerState, ctx: Ctx, cone: TargetCone | null): number {
  if (!cone) return p.yaw;
  return ctx.input.findTarget(cone)?.yaw ?? p.yaw;
}

export function centerHeight(ctx: Ctx): number {
  return ctx.config.physics.playerCapsuleHeight / 2;
}

/** 射線の原点(カプセル中心の高さ)。 */
export function shotOrigin(p: PlayerState, ctx: Ctx): Vec3 {
  return add(p.position, vec3(0, ctx.config.climb.attachCheckHeights[0], 0));
}

export function scaledDamage(p: PlayerState, base: number, runtime: ActionRuntime | null): number {
  return Math.round(base * damageMultiplier(p) * (runtime?.damageScale ?? 1));
}

/** attackActive を発火する。 */
export function emitVolumeHit(
  p: PlayerState,
  ctx: Ctx,
  shape: HitShape,
  damage: number,
  kind: AttackKind,
  profile: HitProfile,
  radiusScale = 1,
): void {
  if (!p.attack) return;
  const volume: HitVolume = volumeFromShape(
    shape,
    p.position,
    p.yaw,
    centerHeight(ctx),
    radiusScale,
  );
  const extent = volumeExtent(volume);
  ctx.events.push({
    type: 'attackActive',
    kind,
    attackId: p.attack.attackId,
    center: extent.center,
    radius: extent.radius,
    damage,
    volume,
    profile,
  });
}

/** 散弾・針の雨: 正面 ±spread/2 に均等に並ぶ射線。 */
export function spreadDirections(yaw: number, rays: number, spreadDeg: number): Vec3[] {
  if (rays <= 1) return [directionFromYaw(yaw)];
  const half = (spreadDeg * Math.PI) / 360;
  const dirs: Vec3[] = [];
  for (let i = 0; i < rays; i++) {
    const t = rays === 1 ? 0 : i / (rays - 1);
    dirs.push(directionFromYaw(yaw - half + 2 * half * t));
  }
  return dirs;
}

/** 長押し中の継続コスト(スタミナ / 秒・エネルギー / 秒)。続行不能なら null。 */
export function tickHoldCost(p: PlayerState, ctx: Ctx): PlayerState | null {
  const runtime = p.action;
  if (runtime?.source !== 'hold') return p;
  const cost = ctx.input.style.cost.hold;
  if (cost.type === 'staminaPerSecond') {
    const next = withStamina(
      p,
      ctx,
      drainStamina(p.stamina, cost.rate, ctx.dt, ctx.config.stamina),
    );
    return isStaminaEmpty(next.stamina) ? null : next;
  }
  if (cost.type === 'energyPerSecond') {
    ctx.events.push({ type: 'energySpent', amount: cost.rate * ctx.dt });
    return ctx.input.energy <= 0 ? null : p;
  }
  return p;
}

/** 行動の完了後に then を始める。始められなければ null。 */
export function chainThen(p: PlayerState, ctx: Ctx): PlayerState | null {
  const runtime = p.action;
  if (!runtime?.then) return null;
  return ctx.startAction({ ...p, action: null }, ctx, runtime.then, { source: runtime.source });
}
