import type { SummonSpec } from '../attackStyle/actionSpec';
import type { HitProfile } from '../combat/damage';
import type { AttackKind } from '../hitReaction/hitTables';
import {
  add,
  directionFromYaw,
  distance,
  horizontal,
  normalize,
  scale,
  sub,
  vec3,
  type Vec3,
} from '../math/vec3';
import type { NearbyEnemy } from '../placed/placedObject';

// N4 召喚体(F11)。自律行動する味方。使い魔・ドローン・浮遊剣・分身。

export type SummonPhase = 'follow' | 'charge' | 'launched' | 'return';

export interface Summon {
  readonly id: number;
  readonly attackId: number;
  readonly spec: SummonSpec;
  readonly kind: AttackKind;
  readonly profile: HitProfile;
  readonly styleId: string;
  readonly position: Vec3;
  readonly age: number;
  readonly nextAttackAt: number;
  readonly phase: SummonPhase;
  /** 複数体のときの並び(周回角・追従オフセット) */
  readonly slot: number;
  readonly targetId: number | null;
  readonly alive: boolean;
}

export type SummonAction =
  | {
      readonly type: 'bolt';
      readonly from: Vec3;
      readonly targetId: number;
      readonly damage: number;
      readonly attackId: number;
    }
  | {
      readonly type: 'area';
      readonly center: Vec3;
      readonly radius: number;
      readonly damage: number;
      readonly attackId: number;
    }
  | { readonly type: 'expired' };

export interface SummonStep {
  readonly summon: Summon;
  readonly actions: readonly SummonAction[];
}

const CHARGE_SPEED = 12;
const SWORD_SPEED = 14;
const FOLLOW_LERP = 6;

export function createSummon(
  id: number,
  attackId: number,
  spec: SummonSpec,
  kind: AttackKind,
  profile: HitProfile,
  styleId: string,
  playerFeet: Vec3,
  playerYaw: number,
  slot: number,
): Summon {
  return {
    id,
    attackId,
    spec,
    kind,
    profile,
    styleId,
    position: homePosition(spec, playerFeet, playerYaw, slot, 0),
    age: 0,
    nextAttackAt: spec.entity === 'mirage' ? 1.0 : spec.interval,
    phase: 'follow',
    slot,
    targetId: null,
    alive: true,
  };
}

/** 追従位置。使い魔は左後方、ドローンは頭上、浮遊剣は周回、分身は前方 2 m。 */
export function homePosition(
  spec: SummonSpec,
  playerFeet: Vec3,
  playerYaw: number,
  slot: number,
  age: number,
): Vec3 {
  const forward = directionFromYaw(playerYaw);
  switch (spec.entity) {
    case 'familiar':
      return add(
        playerFeet,
        add(scale(forward, -0.8), vec3(-forward.z * 1.0, 1.0, forward.x * 1.0)),
      );
    case 'drone':
      return add(playerFeet, vec3(0, 2.2, 0));
    case 'swords': {
      const angle = age * 1.5 + (slot * Math.PI * 2) / Math.max(1, spec.count);
      return add(playerFeet, vec3(Math.sin(angle) * 1.5, 1.3, Math.cos(angle) * 1.5));
    }
    case 'mirage': {
      const side = spec.count > 1 ? (slot - (spec.count - 1) / 2) * 1.2 : 0;
      return add(
        playerFeet,
        add(scale(forward, 2.0), vec3(-forward.z * side, 0, forward.x * side)),
      );
    }
    case 'turret':
      return playerFeet;
  }
}

function nearestEnemy(
  from: Vec3,
  enemies: readonly NearbyEnemy[],
  range: number,
): NearbyEnemy | null {
  let best: NearbyEnemy | null = null;
  let bestDist = Infinity;
  for (const e of enemies) {
    const d = distance(horizontal(e.feet), horizontal(from));
    if (d <= range && d < bestDist) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}

function moveTowards(
  from: Vec3,
  to: Vec3,
  speed: number,
  dt: number,
): { position: Vec3; arrived: boolean } {
  const d = sub(to, from);
  const len = Math.hypot(d.x, d.y, d.z);
  const step = speed * dt;
  if (len <= step) return { position: to, arrived: true };
  return { position: add(from, scale(normalize(d), step)), arrived: false };
}

export function commandSummon(s: Summon, command: 'charge' | 'launchAll' | 'boost'): Summon {
  if (command === 'boost') return { ...s, nextAttackAt: Math.min(s.nextAttackAt, s.age) };
  if (s.phase !== 'follow') return s;
  return { ...s, phase: command === 'charge' ? 'charge' : 'launched', targetId: null };
}

export function stepSummon(
  s: Summon,
  enemies: readonly NearbyEnemy[],
  playerFeet: Vec3,
  playerYaw: number,
  dt: number,
): SummonStep {
  if (!s.alive) return { summon: s, actions: [] };
  const spec = s.spec;
  const age = s.age + dt;
  const actions: SummonAction[] = [];
  let next: Summon = { ...s, age };
  if (age >= spec.lifetime)
    return { summon: { ...next, alive: false }, actions: [{ type: 'expired' }] };
  switch (next.phase) {
    case 'follow': {
      const home = homePosition(spec, playerFeet, playerYaw, s.slot, age);
      const k = spec.entity === 'mirage' ? 1 : Math.min(1, FOLLOW_LERP * dt);
      next = { ...next, position: add(next.position, scale(sub(home, next.position), k)) };
      if (age >= next.nextAttackAt) {
        const target = nearestEnemy(next.position, enemies, spec.range);
        if (spec.entity === 'mirage') {
          actions.push({
            type: 'area',
            center: add(next.position, vec3(0, 0.85, 0)),
            radius: spec.range,
            damage: spec.damage,
            attackId: s.attackId + s.slot,
          });
          next = { ...next, nextAttackAt: age + spec.interval };
        } else if (target) {
          if (spec.entity === 'swords') {
            next = {
              ...next,
              phase: 'launched',
              targetId: target.id,
              nextAttackAt: age + spec.interval * spec.count,
            };
          } else {
            actions.push({
              type: 'bolt',
              from: next.position,
              targetId: target.id,
              damage: spec.damage,
              attackId: s.attackId + s.slot,
            });
            next = { ...next, nextAttackAt: age + spec.interval };
          }
        }
      }
      return { summon: next, actions };
    }
    case 'charge':
    case 'launched': {
      const target =
        next.targetId === null
          ? nearestEnemy(next.position, enemies, spec.range * 2)
          : (enemies.find((e) => e.id === next.targetId) ?? null);
      if (!target)
        return {
          summon: {
            ...next,
            phase: spec.entity === 'drone' && next.phase === 'charge' ? 'charge' : 'return',
            targetId: null,
          },
          actions,
        };
      const speed = next.phase === 'charge' ? CHARGE_SPEED : SWORD_SPEED;
      const moved = moveTowards(next.position, target.center, speed, dt);
      next = { ...next, position: moved.position, targetId: target.id };
      if (!moved.arrived) return { summon: next, actions };
      const damage = next.phase === 'charge' ? (spec.commandDamage ?? spec.damage) : spec.damage;
      const radius = next.phase === 'charge' ? (spec.commandRadius ?? 1.0) : 0.8;
      actions.push({
        type: 'area',
        center: target.center,
        radius,
        damage,
        attackId: s.attackId + s.slot + 100 * Math.floor(age),
      });
      if (spec.entity === 'drone' && next.phase === 'charge') {
        return { summon: { ...next, alive: false }, actions: [...actions, { type: 'expired' }] };
      }
      return { summon: { ...next, phase: 'return', targetId: null }, actions };
    }
    case 'return': {
      const home = homePosition(spec, playerFeet, playerYaw, s.slot, age);
      const moved = moveTowards(next.position, home, SWORD_SPEED, dt);
      next = { ...next, position: moved.position };
      if (moved.arrived) next = { ...next, phase: 'follow' };
      return { summon: next, actions };
    }
  }
}
