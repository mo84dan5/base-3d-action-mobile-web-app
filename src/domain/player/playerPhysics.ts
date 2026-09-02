import type { GameConfig } from '../config/gameConfig';
import { add, clamp, dot, removeComponentAlong, scale, vec3, type Vec3 } from '../math/vec3';
import { classifySurface, wallNormalY, type SurfaceKind } from '../physics/surface';
import type { CapsuleShape, TerrainQuery } from '../terrain/terrainQuery';

// プレイヤー・敵に共通するキネマティックな移動処理(F05 キャラクター物理)。

export interface GroundProbe {
  readonly kind: 'walkable' | 'slide' | 'none';
  readonly normal: Vec3;
  /** 接地させるときの足元 y */
  readonly snapY: number;
}

const NO_GROUND: GroundProbe = { kind: 'none', normal: vec3(0, 1, 0), snapY: 0 };

export function playerCapsule(config: GameConfig): CapsuleShape {
  return { radius: config.physics.playerCapsuleRadius, height: config.physics.playerCapsuleHeight };
}

export function enemyCapsule(config: GameConfig): CapsuleShape {
  return { radius: config.enemy.capsuleRadius, height: config.enemy.capsuleHeight };
}

/**
 * 足元から下方向へ探り、maxGap 以内に歩行可能面 / 滑り面があれば返す。
 * 下側半球の中心から真下へキャストし、面の傾きぶん(r / normalY)を差し引いた隙間で判定する。
 */
export function probeGround(
  feet: Vec3,
  shape: CapsuleShape,
  terrain: TerrainQuery,
  maxGap: number,
  config: GameConfig,
): GroundProbe {
  const origin = add(feet, vec3(0, shape.radius, 0));
  const maxRest = shape.radius / wallNormalY(config.physics);
  const hit = terrain.raycast(origin, vec3(0, -1, 0), maxRest + maxGap);
  if (!hit) return NO_GROUND;
  const kind = classifySurface(hit.normal.y, config.physics);
  if (kind === 'wall' || kind === 'ceiling') return NO_GROUND;
  const restDistance = shape.radius / hit.normal.y;
  const gap = hit.distance - restDistance;
  if (gap > maxGap) return NO_GROUND;
  return { kind, normal: hit.normal, snapY: hit.point.y + restDistance - shape.radius };
}

export interface WallContact {
  readonly normal: Vec3;
}

export interface MoveResult {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly ground: GroundProbe;
  /** 壁(斜度 60 度以上)との接触 */
  readonly walls: readonly WallContact[];
  readonly hitCeiling: boolean;
}

function contactKinds(
  contacts: readonly { normal: Vec3 }[],
  config: GameConfig,
): { walls: WallContact[]; ceiling: boolean } {
  const walls: WallContact[] = [];
  let ceiling = false;
  for (const c of contacts) {
    const kind: SurfaceKind = classifySurface(c.normal.y, config.physics);
    if (kind === 'wall') walls.push({ normal: c.normal });
    if (kind === 'ceiling') ceiling = true;
  }
  return { walls, ceiling };
}

/** ステージ外へ出ないよう x, z を ±worldBound にクランプする。 */
export function clampToWorld(p: Vec3, config: GameConfig): Vec3 {
  const b = config.physics.worldBound;
  return vec3(clamp(p.x, -b, b), p.y, clamp(p.z, -b, b));
}

/**
 * 接地中の移動。水平速度で進め、壁に当たれば壁ずり、段差(0.4 m 以下)は自動で乗り越え、
 * 斜面には吸着する。接地を失えば ground.kind = 'none' を返す。
 */
export function moveOnGround(
  feet: Vec3,
  velocity: Vec3,
  dt: number,
  shape: CapsuleShape,
  terrain: TerrainQuery,
  config: GameConfig,
): MoveResult {
  const horizontalVelocity = vec3(velocity.x, 0, velocity.z);
  const moved = add(feet, scale(horizontalVelocity, dt));
  const resolved = terrain.resolveCapsule(moved, shape);
  const { walls, ceiling } = contactKinds(resolved.contacts, config);
  const maxGap = config.physics.groundCastDistance + config.physics.stepOffset;
  let position = resolved.position;
  let ground = probeGround(position, shape, terrain, maxGap, config);
  for (const wall of walls) {
    const stepped = tryStepUp(feet, wall, shape, terrain, config);
    if (!stepped) continue;
    position = stepped.position;
    ground = stepped.ground;
    break;
  }
  let v = horizontalVelocity;
  for (const w of walls) if (dot(v, w.normal) < 0) v = removeComponentAlong(v, w.normal);
  if (ground.kind !== 'none') {
    position = vec3(position.x, ground.snapY, position.z);
  }
  return {
    position: clampToWorld(position, config),
    velocity: v,
    ground,
    walls,
    hitCeiling: ceiling,
  };
}

/**
 * 段差の自動乗り越え(ステップオフセット 0.4 m)。
 * 壁に当たったとき、壁の内側(カプセル中心から半径 + 0.05 m 先)を上からレイキャストし、
 * 段差の上面が 0.4 m 以下の高さにあり、その位置にカプセルを置いても壁に当たらなければ乗り上げる。
 */
function tryStepUp(
  feet: Vec3,
  wall: WallContact,
  shape: CapsuleShape,
  terrain: TerrainQuery,
  config: GameConfig,
): { position: Vec3; ground: GroundProbe } | null {
  const step = config.physics.stepOffset;
  const margin = 0.05;
  const into = normalizeHorizontal(scale(wall.normal, -1));
  if (!into) return null;
  const target = add(feet, scale(into, shape.radius + margin));
  const origin = vec3(target.x, feet.y + step + margin, target.z);
  const hit = terrain.raycast(origin, vec3(0, -1, 0), step + margin);
  if (!hit || classifySurface(hit.normal.y, config.physics) !== 'walkable') return null;
  const rise = hit.point.y - feet.y;
  if (rise <= 0.01 || rise > step + 1e-6) return null;
  const placed = terrain.resolveCapsule(vec3(target.x, hit.point.y, target.z), shape);
  if (contactKinds(placed.contacts, config).walls.length > 0) return null;
  const ground = probeGround(
    placed.position,
    shape,
    terrain,
    config.physics.groundCastDistance,
    config,
  );
  if (ground.kind !== 'walkable') return null;
  return { position: vec3(placed.position.x, ground.snapY, placed.position.z), ground };
}

function normalizeHorizontal(v: Vec3): Vec3 | null {
  const len = Math.hypot(v.x, v.z);
  if (len < 1e-6) return null;
  return vec3(v.x / len, 0, v.z / len);
}

/**
 * 空中・滑り面での移動。速度で進め、壁では法線成分を除去して滑り、天井では鉛直速度を 0 にする。
 * 下降中に足元 0.1 m 以内へ歩行可能面 / 滑り面が来たら ground に返す(着地判定は呼び出し側)。
 */
export function moveInAir(
  feet: Vec3,
  velocity: Vec3,
  dt: number,
  shape: CapsuleShape,
  terrain: TerrainQuery,
  config: GameConfig,
): MoveResult {
  const moved = add(feet, scale(velocity, dt));
  const resolved = terrain.resolveCapsule(moved, shape);
  const { walls, ceiling } = contactKinds(resolved.contacts, config);
  let v = velocity;
  for (const c of resolved.contacts) {
    if (dot(v, c.normal) < 0) v = removeComponentAlong(v, c.normal);
  }
  if (ceiling && v.y > 0) v = vec3(v.x, 0, v.z);
  const descending = velocity.y <= 0;
  const ground = descending
    ? probeGround(resolved.position, shape, terrain, config.physics.groundCastDistance, config)
    : NO_GROUND;
  const position =
    ground.kind !== 'none'
      ? vec3(resolved.position.x, ground.snapY, resolved.position.z)
      : resolved.position;
  return {
    position: clampToWorld(position, config),
    velocity: v,
    ground,
    walls,
    hitCeiling: ceiling,
  };
}

/** 速度ベクトルを目標へ最大 maxDelta だけ近づける。 */
export function moveVelocityTowards(current: Vec3, target: Vec3, maxDelta: number): Vec3 {
  const diff = vec3(target.x - current.x, target.y - current.y, target.z - current.z);
  const len = Math.hypot(diff.x, diff.y, diff.z);
  if (len <= maxDelta || len === 0) return target;
  return add(current, scale(diff, maxDelta / len));
}
