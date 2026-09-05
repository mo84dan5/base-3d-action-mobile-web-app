import type { ProjectileSpec } from '../attackStyle/actionSpec';
import type { HitProfile } from '../combat/damage';
import type { AttackKind } from '../hitReaction/hitTables';
import {
  add,
  distance,
  dot,
  horizontal,
  length,
  normalize,
  rotateTowards,
  scale,
  sub,
  vec3,
  wrapAngle,
  yawFromDirection,
  type Vec3,
} from '../math/vec3';
import type { TerrainQuery } from '../terrain/terrainQuery';

// N1 発射体(F11)。直進・放物線・追尾・往復・反射・周回の弾を物理ステップで進める。
// 敵との命中判定は application が行い、onHit を呼ぶ。

export type ProjectilePhase = 'out' | 'return' | 'orbit';

export interface Projectile {
  readonly id: number;
  readonly attackId: number;
  readonly spec: ProjectileSpec;
  readonly kind: AttackKind;
  readonly profile: HitProfile;
  readonly styleId: string;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly travelled: number;
  readonly age: number;
  readonly phase: ProjectilePhase;
  readonly bouncesLeft: number;
  readonly damage: number;
  readonly range: number;
  readonly hitTargets: readonly number[];
  readonly orbitAngle: number;
  readonly alive: boolean;
}

export interface ProjectileWorld {
  readonly playerCenter: Vec3;
  /** 追尾先(最も近い敵の中心)。無ければ null */
  readonly homingTarget: Vec3 | null;
  readonly terrain: TerrainQuery;
  readonly gravity: number;
}

export type ProjectileEnd =
  | {
      readonly type: 'explode';
      readonly center: Vec3;
      readonly radius: number;
      readonly damage: number;
    }
  | { readonly type: 'expired' };

export interface ProjectileStep {
  readonly projectile: Projectile;
  readonly ends: readonly ProjectileEnd[];
}

const HOMING_TURN_RATE = Math.PI; // rad/s
const RETURN_CATCH_DISTANCE = 0.6;
const ORBIT_ANGULAR_SPEED_FROM = (spec: ProjectileSpec, radius: number) =>
  spec.speed / Math.max(0.5, radius);

export function createProjectile(
  id: number,
  attackId: number,
  spec: ProjectileSpec,
  kind: AttackKind,
  profile: HitProfile,
  styleId: string,
  origin: Vec3,
  direction: Vec3,
  damage: number,
  range: number,
): Projectile {
  return {
    id,
    attackId,
    spec,
    kind,
    profile,
    styleId,
    position: origin,
    velocity: scale(normalize(direction), spec.speed),
    travelled: 0,
    age: 0,
    phase: spec.orbit ? 'orbit' : 'out',
    bouncesLeft: spec.bounces,
    damage,
    range,
    hitTargets: [],
    orbitAngle: yawFromDirection(direction),
    alive: true,
  };
}

function endOf(pr: Projectile): ProjectileEnd {
  if (pr.spec.explosion) {
    return {
      type: 'explode',
      center: pr.position,
      radius: pr.spec.explosion.radius,
      damage: pr.spec.explosion.damage,
    };
  }
  return { type: 'expired' };
}

function die(pr: Projectile): ProjectileStep {
  return { projectile: { ...pr, alive: false }, ends: [endOf(pr)] };
}

function steerTowards(velocity: Vec3, target: Vec3, from: Vec3, dt: number): Vec3 {
  const speed = length(velocity);
  if (speed === 0) return velocity;
  const currentYaw = yawFromDirection(velocity);
  const desired = yawFromDirection(horizontal(sub(target, from)));
  const yaw = rotateTowards(currentYaw, desired, HOMING_TURN_RATE * dt);
  const h = Math.hypot(velocity.x, velocity.z);
  const dy = target.y - from.y;
  const vy = Math.abs(dy) > 0.2 ? Math.sign(dy) * Math.min(Math.abs(dy) * 2, speed * 0.3) : 0;
  return vec3(Math.sin(yaw) * h, vy, Math.cos(yaw) * h);
}

function stepOrbit(pr: Projectile, world: ProjectileWorld, dt: number): ProjectileStep {
  const orbit = pr.spec.orbit;
  if (!orbit) return die(pr);
  const angular = ORBIT_ANGULAR_SPEED_FROM(pr.spec, orbit.radius);
  const angle = pr.orbitAngle + angular * dt;
  const position = add(
    world.playerCenter,
    vec3(Math.sin(angle) * orbit.radius, 0, Math.cos(angle) * orbit.radius),
  );
  const travelledAngle = pr.travelled + angular * dt;
  const next: Projectile = {
    ...pr,
    position,
    velocity: scale(sub(position, pr.position), dt > 0 ? 1 / dt : 0),
    orbitAngle: angle,
    travelled: travelledAngle,
    age: pr.age + dt,
    // 周回中は同じ敵に 1 周ごとに当たる
    hitTargets:
      Math.floor(travelledAngle / (Math.PI * 2)) > Math.floor(pr.travelled / (Math.PI * 2))
        ? []
        : pr.hitTargets,
  };
  if (travelledAngle >= Math.PI * 2 * orbit.turns)
    return { projectile: { ...next, alive: false }, ends: [{ type: 'expired' }] };
  return { projectile: next, ends: [] };
}

/** 1 ステップ進める。地形に当たれば反射または終了、射程を越えれば往復か終了。 */
export function stepProjectile(pr: Projectile, world: ProjectileWorld, dt: number): ProjectileStep {
  if (!pr.alive) return { projectile: pr, ends: [] };
  if (pr.phase === 'orbit') return stepOrbit(pr, world, dt);
  let velocity = pr.velocity;
  if (pr.spec.gravity) velocity = vec3(velocity.x, velocity.y - world.gravity * dt, velocity.z);
  if (pr.spec.homing && world.homingTarget && pr.phase === 'out') {
    velocity = steerTowards(velocity, world.homingTarget, pr.position, dt);
  }
  if (pr.phase === 'return') {
    const to = sub(world.playerCenter, pr.position);
    if (length(to) <= RETURN_CATCH_DISTANCE)
      return { projectile: { ...pr, alive: false }, ends: [{ type: 'expired' }] };
    velocity = scale(normalize(to), pr.spec.speed);
  }
  const stepLength = length(velocity) * dt;
  const dir = stepLength > 0 ? normalize(velocity) : velocity;
  const hit =
    stepLength > 0 ? world.terrain.raycast(pr.position, dir, stepLength + pr.spec.radius) : null;
  if (hit && pr.phase === 'out') {
    if (pr.bouncesLeft > 0) {
      const reflected = sub(velocity, scale(hit.normal, 2 * dot(velocity, hit.normal)));
      const position = add(hit.point, scale(hit.normal, pr.spec.radius + 0.01));
      return {
        projectile: {
          ...pr,
          position,
          velocity: reflected,
          bouncesLeft: pr.bouncesLeft - 1,
          age: pr.age + dt,
          hitTargets: [],
        },
        ends: [],
      };
    }
    if (pr.spec.returning)
      return {
        projectile: {
          ...pr,
          position: hit.point,
          phase: 'return',
          hitTargets: [],
          age: pr.age + dt,
        },
        ends: [],
      };
    return die({ ...pr, position: hit.point });
  }
  if (hit && pr.phase === 'return') {
    // 帰りは地形をすり抜けて手元へ戻る
  }
  const position = add(pr.position, scale(velocity, dt));
  const travelled = pr.travelled + stepLength;
  const next: Projectile = { ...pr, position, velocity, travelled, age: pr.age + dt };
  if (pr.phase === 'out' && travelled >= pr.range) {
    if (pr.spec.returning)
      return { projectile: { ...next, phase: 'return', hitTargets: [] }, ends: [] };
    return die(next);
  }
  if (position.y < -5)
    return { projectile: { ...next, alive: false }, ends: [{ type: 'expired' }] };
  return { projectile: next, ends: [] };
}

/** 敵に当たった後の扱い。貫通・往復なら続行、そうでなければ終了。 */
export function onProjectileHit(pr: Projectile, enemyId: number): ProjectileStep {
  const marked: Projectile = { ...pr, hitTargets: [...pr.hitTargets, enemyId] };
  if (pr.spec.pierce || pr.phase === 'orbit') return { projectile: marked, ends: [] };
  if (pr.spec.returning && pr.phase === 'out')
    return { projectile: { ...marked, phase: 'return', hitTargets: [] }, ends: [] };
  if (pr.spec.returning && pr.phase === 'return') return { projectile: marked, ends: [] };
  return die(marked);
}

/** 弾がこのステップで通った線分と点の距離(掃引判定用)。 */
export function sweptDistance(pr: Projectile, previous: Vec3, point: Vec3): number {
  const seg = sub(pr.position, previous);
  const len2 = dot(seg, seg);
  if (len2 === 0) return distance(pr.position, point);
  const t = Math.min(1, Math.max(0, dot(sub(point, previous), seg) / len2));
  return distance(add(previous, scale(seg, t)), point);
}

export function projectileYaw(pr: Projectile): number {
  const h = horizontal(pr.velocity);
  return h.x === 0 && h.z === 0 ? pr.orbitAngle : yawFromDirection(h);
}

export { wrapAngle };
