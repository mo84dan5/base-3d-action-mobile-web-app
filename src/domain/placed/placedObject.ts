import type { PlacedSpec } from '../attackStyle/actionSpec';
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

// N3 設置物(F11)。位置・寿命・起動条件を持つ判定体。地雷・タレット・杭・結界・壁・囮・樽・隕石・重力球。

export interface PlacedObject {
  readonly id: number;
  readonly attackId: number;
  readonly spec: PlacedSpec;
  readonly kind: AttackKind;
  readonly profile: HitProfile;
  readonly styleId: string;
  readonly position: Vec3;
  readonly yaw: number;
  readonly age: number;
  readonly nextTickAt: number;
  /** 強化(タレット)の残り秒 */
  readonly boostRemaining: number;
  /** 押し出し中(壁)・転がり中(樽)の速度 */
  readonly speed: number;
  readonly hitTargets: readonly number[];
  readonly alive: boolean;
}

export interface NearbyEnemy {
  readonly id: number;
  readonly feet: Vec3;
  readonly center: Vec3;
}

export type PlacedAction =
  | {
      readonly type: 'explode';
      readonly center: Vec3;
      readonly radius: number;
      readonly damage: number;
      readonly attackId: number;
    }
  | {
      readonly type: 'tick';
      readonly center: Vec3;
      readonly radius: number;
      readonly damage: number;
      readonly attackId: number;
    }
  | {
      readonly type: 'shoot';
      readonly from: Vec3;
      readonly targetId: number;
      readonly damage: number;
      readonly attackId: number;
    }
  | {
      readonly type: 'pull';
      readonly center: Vec3;
      readonly radius: number;
      readonly speed: number;
    }
  | {
      readonly type: 'touch';
      readonly targetId: number;
      readonly damage: number;
      readonly attackId: number;
    }
  | { readonly type: 'expired' };

export interface PlacedStep {
  readonly object: PlacedObject;
  readonly actions: readonly PlacedAction[];
}

const TURRET_BOOST_SECONDS = 5.0;
const BARREL_TOUCH_RADIUS = 0.8;

export function createPlacedObject(
  id: number,
  attackId: number,
  spec: PlacedSpec,
  kind: AttackKind,
  profile: HitProfile,
  styleId: string,
  position: Vec3,
  yaw: number,
): PlacedObject {
  return {
    id,
    attackId,
    spec,
    kind,
    profile,
    styleId,
    position,
    yaw,
    age: 0,
    nextTickAt: spec.delay > 0 ? spec.delay : spec.interval,
    boostRemaining: 0,
    speed: spec.object === 'barrel' ? (spec.rollSpeed ?? 0) : 0,
    hitTargets: [],
    alive: true,
  };
}

function nearest(
  obj: PlacedObject,
  enemies: readonly NearbyEnemy[],
  radius: number,
): NearbyEnemy | null {
  let best: NearbyEnemy | null = null;
  let bestDist = Infinity;
  for (const e of enemies) {
    const d = distance(horizontal(e.feet), horizontal(obj.position));
    if (d <= radius && d < bestDist) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}

function expire(obj: PlacedObject, extra: PlacedAction[] = []): PlacedStep {
  return { object: { ...obj, alive: false }, actions: [...extra, { type: 'expired' }] };
}

/** 全起爆・爆破の命令(地雷・囮)。 */
export function detonate(obj: PlacedObject, damage: number, radius: number): PlacedStep {
  return expire(obj, [
    { type: 'explode', center: obj.position, radius, damage, attackId: obj.attackId },
  ]);
}

export function boost(obj: PlacedObject): PlacedObject {
  return { ...obj, boostRemaining: TURRET_BOOST_SECONDS };
}

export function push(obj: PlacedObject, speed: number): PlacedObject {
  return { ...obj, speed, hitTargets: [] };
}

/** 1 ステップ進める。 */
export function stepPlacedObject(
  obj: PlacedObject,
  enemies: readonly NearbyEnemy[],
  dt: number,
): PlacedStep {
  if (!obj.alive) return { object: obj, actions: [] };
  const spec = obj.spec;
  const age = obj.age + dt;
  const center = add(obj.position, vec3(0, 0.5, 0));
  let next: PlacedObject = { ...obj, age, boostRemaining: Math.max(0, obj.boostRemaining - dt) };
  switch (spec.object) {
    case 'mine': {
      if (age < spec.delay) return { object: next, actions: [] };
      const near = nearest(next, enemies, spec.radius);
      if (near) return detonate(next, spec.damage, spec.radius);
      break;
    }
    case 'stake':
    case 'meteor': {
      if (age >= spec.delay) {
        return expire(next, [
          {
            type: 'explode',
            center,
            radius: spec.radius,
            damage: spec.damage,
            attackId: obj.attackId,
          },
        ]);
      }
      return { object: next, actions: [] };
    }
    case 'turret': {
      const actions: PlacedAction[] = [];
      const interval = next.boostRemaining > 0 ? spec.interval / 2 : spec.interval;
      if (age >= next.nextTickAt) {
        const target = nearest(next, enemies, spec.radius);
        if (target)
          actions.push({
            type: 'shoot',
            from: add(obj.position, vec3(0, 0.8, 0)),
            targetId: target.id,
            damage: spec.damage,
            attackId: obj.attackId,
          });
        next = { ...next, nextTickAt: age + interval };
      }
      if (age >= spec.lifetime) return expire(next, actions);
      return { object: next, actions };
    }
    case 'field': {
      const actions: PlacedAction[] = [];
      if (age >= next.nextTickAt) {
        actions.push({
          type: 'tick',
          center,
          radius: spec.radius,
          damage: spec.damage,
          attackId: obj.attackId,
        });
        next = { ...next, nextTickAt: age + spec.interval };
      }
      if (age >= spec.lifetime) return expire(next, actions);
      return { object: next, actions };
    }
    case 'gravity': {
      const actions: PlacedAction[] = [
        { type: 'pull', center: obj.position, radius: spec.radius, speed: spec.pullSpeed ?? 0 },
      ];
      if (age >= next.nextTickAt) {
        actions.push({
          type: 'tick',
          center,
          radius: spec.radius,
          damage: spec.damage,
          attackId: obj.attackId,
        });
        next = { ...next, nextTickAt: age + spec.interval };
      }
      if (age >= spec.lifetime) return expire(next, actions);
      return { object: next, actions };
    }
    case 'wall': {
      const actions: PlacedAction[] = [];
      if (next.speed > 0) {
        next = {
          ...next,
          position: add(next.position, scale(directionFromYaw(next.yaw), next.speed * dt)),
        };
        for (const e of enemies) {
          if (next.hitTargets.includes(e.id)) continue;
          if (distance(horizontal(e.feet), horizontal(next.position)) <= spec.radius + 0.4) {
            actions.push({
              type: 'touch',
              targetId: e.id,
              damage: spec.damage,
              attackId: obj.attackId,
            });
            next = { ...next, hitTargets: [...next.hitTargets, e.id] };
          }
        }
      }
      if (age >= spec.lifetime) return expire(next, actions);
      return { object: next, actions };
    }
    case 'barrel': {
      next = {
        ...next,
        position: add(next.position, scale(directionFromYaw(next.yaw), next.speed * dt)),
      };
      const touched = nearest(next, enemies, BARREL_TOUCH_RADIUS + 0.4);
      if (touched || age >= spec.lifetime) {
        return expire(next, [
          {
            type: 'explode',
            center: add(next.position, vec3(0, 0.5, 0)),
            radius: spec.radius,
            damage: spec.damage,
            attackId: obj.attackId,
          },
        ]);
      }
      return { object: next, actions: [] };
    }
    case 'decoy':
      break;
  }
  if (age >= spec.lifetime) return expire(next);
  return { object: next, actions: [] };
}

/** 壁の外へ敵を押し出す位置(敵 AI のみ遮る。地形コリジョンではない)。 */
export function pushOutOfWall(obj: PlacedObject, feet: Vec3, enemyRadius: number): Vec3 | null {
  if (obj.spec.object !== 'wall' || !obj.spec.blocksEnemies) return null;
  const to = horizontal(sub(feet, obj.position));
  const d = Math.hypot(to.x, to.z);
  const min = obj.spec.radius + enemyRadius;
  if (d >= min) return null;
  const dir = d === 0 ? directionFromYaw(obj.yaw) : normalize(to);
  return add(obj.position, vec3(dir.x * min, feet.y - obj.position.y, dir.z * min));
}
