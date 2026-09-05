import type { GameConfig } from '../config/gameConfig';
import {
  UP,
  add,
  cross,
  dot,
  normalize,
  scale,
  sub,
  vec3,
  yawFromDirection,
  type Vec3,
} from '../math/vec3';
import { classifySurface } from '../physics/surface';
import type { TerrainHit, TerrainQuery } from '../terrain/terrainQuery';
import { playerCapsule } from './playerPhysics';

// 崖登りの取り付き判定・面の追従・頂上判定(F08)。

export interface AttachCandidate {
  readonly normal: Vec3;
  /** カプセル中心高さでの面上の点 */
  readonly point: Vec3;
}

function isClimbableWall(hit: TerrainHit | null, config: GameConfig): hit is TerrainHit {
  return (
    hit !== null && !hit.unclimbable && classifySurface(hit.normal.y, config.physics) === 'wall'
  );
}

function sameFace(a: TerrainHit, b: TerrainHit): boolean {
  return dot(a.normal, b.normal) > 0.99;
}

/**
 * 取り付き可能な面を探す。カプセル中心(足元 + 0.85 m)と頭上(足元 + 1.7 m)から dir 方向へキャストし、
 * 両方が同じ登攀可の壁に当たれば取り付き候補を返す(高さ 1.7 m 未満の段差には取り付かない)。
 */
export function findAttachWall(
  feet: Vec3,
  dir: Vec3,
  reach: number,
  terrain: TerrainQuery,
  config: GameConfig,
): AttachCandidate | null {
  const [centerH, headH] = config.climb.attachCheckHeights;
  const distance = config.physics.playerCapsuleRadius + reach;
  const center = terrain.raycast(add(feet, vec3(0, centerH, 0)), dir, distance);
  if (!isClimbableWall(center, config)) return null;
  const head = terrain.raycast(add(feet, vec3(0, headH, 0)), dir, distance + 0.2);
  if (!isClimbableWall(head, config) || !sameFace(center, head)) return null;
  return { normal: center.normal, point: center.point };
}

/** 取り付き時の足元位置: カプセル中心が面から 0.5 m の位置。 */
export function attachFeetPosition(
  candidate: AttachCandidate,
  feet: Vec3,
  config: GameConfig,
): Vec3 {
  const center = add(candidate.point, scale(candidate.normal, config.climb.attachDistanceFromWall));
  return vec3(center.x, feet.y, center.z);
}

export function yawFacingWall(normal: Vec3): number {
  return yawFromDirection(scale(normal, -1));
}

export interface WallFrame {
  readonly up: Vec3;
  readonly right: Vec3;
  readonly into: Vec3;
}

/** 面の座標系(面に沿った上・右、面へ向かう方向)。 */
export function wallFrame(normal: Vec3): WallFrame {
  const up = normalize(sub(UP, scale(normal, dot(UP, normal))));
  const into = scale(normal, -1);
  const right = normalize(cross(into, UP));
  return { up, right, into };
}

/** 登攀中のスティック入力(x 右, y 上)を面に沿った速度に変換する。 */
export function climbVelocity(
  stickX: number,
  stickY: number,
  magnitude: number,
  frame: WallFrame,
  config: GameConfig,
): Vec3 {
  if (magnitude === 0) return vec3(0, 0, 0);
  const vertical = stickY >= 0 ? stickY * config.climb.upSpeed : stickY * config.climb.downSpeed;
  return add(scale(frame.up, vertical), scale(frame.right, stickX * config.climb.sideSpeed));
}

export interface WallReacquire {
  readonly normal: Vec3;
  readonly feet: Vec3;
}

/** カプセル中心から正面 0.8 m のキャストで面を再取得し、中心が面から 0.5 m になる位置を返す。見失えば null。 */
export function reacquireWall(
  feet: Vec3,
  normal: Vec3,
  terrain: TerrainQuery,
  config: GameConfig,
): WallReacquire | null {
  const centerH = config.climb.attachCheckHeights[0];
  const origin = add(feet, vec3(0, centerH, 0));
  const hit = terrain.raycast(origin, scale(normal, -1), config.climb.wallReacquireDistance);
  if (!isClimbableWall(hit, config)) return null;
  const center = add(hit.point, scale(hit.normal, config.climb.attachDistanceFromWall));
  return { normal: hit.normal, feet: vec3(center.x, feet.y, center.z) };
}

/**
 * 頂上判定。頭上(足元 + 2.2 m)から正面 0.8 m のキャストが面に当たらず、
 * その先(面の内側 0.5 m)から下方向 2.4 m のキャストが歩行可能面に当たれば、その点(足元)を返す。
 */
export function findMantleTarget(
  feet: Vec3,
  normal: Vec3,
  terrain: TerrainQuery,
  config: GameConfig,
): Vec3 | null {
  const c = config.climb;
  const into = scale(normal, -1);
  const centerH = c.attachCheckHeights[0];
  // カプセル中心から頭上判定の高さまで真上に障害物(オーバーハングの張り出しなど)があれば頂上ではない
  const center = add(feet, vec3(0, centerH, 0));
  if (terrain.raycast(center, vec3(0, 1, 0), c.topCheckHeight - centerH)) return null;
  const head = add(feet, vec3(0, c.topCheckHeight, 0));
  if (terrain.raycast(head, into, c.topCheckForward)) return null;
  const beyond = add(head, scale(into, c.topCheckForward + c.topCheckInset));
  const down = terrain.raycast(beyond, vec3(0, -1, 0), c.topCheckDownDistance);
  if (!down || classifySurface(down.normal.y, config.physics) !== 'walkable') return null;
  // よじ登り先にカプセルを置いて地形と重なる(オーバーハングの内部など)なら頂上ではない
  const placed = terrain.resolveCapsule(down.point, playerCapsule(config));
  if (placed.contacts.some((contact) => contact.depth > MANTLE_CLEARANCE_TOLERANCE)) return null;
  return down.point;
}

/** よじ登り先の空きを判定する貫入の許容量(m)。浮動小数の誤差と接地面との接触を無視する */
const MANTLE_CLEARANCE_TOLERANCE = 0.02;
