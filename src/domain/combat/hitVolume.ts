import type { HitShape } from '../attackStyle/actionSpec';
import { degToRad } from '../config/gameConfig';
import {
  add,
  directionFromYaw,
  distance,
  dot,
  horizontal,
  normalize,
  scale,
  sub,
  vec3,
  wrapAngle,
  yawFromDirection,
  type Vec3,
} from '../math/vec3';
import { closestPointOnCapsuleToSphere, sphereCapsuleOverlap, type Capsule } from './hitGeometry';

// 当たり判定の体積(F11 A5: 球・扇・リング・直線)。スタイル定義の HitShape を世界座標へ置いたもの。
export type HitVolume =
  | { readonly type: 'sphere'; readonly center: Vec3; readonly radius: number }
  | {
      readonly type: 'fan';
      readonly origin: Vec3;
      readonly yaw: number;
      readonly radius: number;
      readonly angleDeg: number;
    }
  | {
      readonly type: 'ring';
      readonly origin: Vec3;
      readonly radius: number;
      readonly width: number;
    }
  | {
      readonly type: 'line';
      readonly origin: Vec3;
      readonly yaw: number;
      readonly length: number;
      readonly width: number;
    };

/** 判定の高さの上下許容(m)。扇・リング・直線は水平面で判定し、高さ差がこの範囲なら当てる。 */
const VERTICAL_TOLERANCE = 1.6;

/** HitShape をプレイヤーの足元・向きから世界座標の体積にする。 */
export function volumeFromShape(
  shape: HitShape,
  feet: Vec3,
  yaw: number,
  centerHeight: number,
  radiusScale = 1,
): HitVolume {
  const origin = add(feet, vec3(0, centerHeight, 0));
  switch (shape.type) {
    case 'sphere':
      return {
        type: 'sphere',
        center: add(origin, scale(directionFromYaw(yaw), shape.forward)),
        radius: shape.radius * radiusScale,
      };
    case 'fan':
      return {
        type: 'fan',
        origin,
        yaw,
        radius: shape.radius * radiusScale,
        angleDeg: shape.angleDeg,
      };
    case 'ring':
      return { type: 'ring', origin, radius: shape.radius * radiusScale, width: shape.width };
    case 'line':
      return { type: 'line', origin, yaw, length: shape.length * radiusScale, width: shape.width };
  }
}

/** 体積の代表点と外径(VFX の位置・大きさに使う)。 */
export function volumeExtent(v: HitVolume): { readonly center: Vec3; readonly radius: number } {
  switch (v.type) {
    case 'sphere':
      return { center: v.center, radius: v.radius };
    case 'fan':
      return { center: v.origin, radius: v.radius };
    case 'ring':
      return { center: v.origin, radius: v.radius };
    case 'line':
      return {
        center: add(v.origin, scale(directionFromYaw(v.yaw), v.length / 2)),
        radius: v.length / 2,
      };
  }
}

function withinHeight(origin: Vec3, capsule: Capsule): boolean {
  const bottom = capsule.feet.y;
  const top = capsule.feet.y + capsule.height;
  return origin.y >= bottom - VERTICAL_TOLERANCE && origin.y <= top + VERTICAL_TOLERANCE;
}

function horizontalDistanceAndYaw(origin: Vec3, capsule: Capsule) {
  const to = horizontal(sub(capsule.feet, origin));
  const dist = Math.hypot(to.x, to.z);
  return { dist, yaw: dist === 0 ? 0 : yawFromDirection(to), to };
}

/** 体積とカプセルの重なり。 */
export function volumeCapsuleOverlap(v: HitVolume, capsule: Capsule): boolean {
  switch (v.type) {
    case 'sphere':
      return sphereCapsuleOverlap(v.center, v.radius, capsule);
    case 'fan': {
      if (!withinHeight(v.origin, capsule)) return false;
      const { dist, yaw } = horizontalDistanceAndYaw(v.origin, capsule);
      if (dist - capsule.radius > v.radius) return false;
      if (dist <= capsule.radius) return true;
      const half = degToRad(v.angleDeg) / 2;
      const angularRadius = Math.asin(Math.min(1, capsule.radius / dist));
      return Math.abs(wrapAngle(yaw - v.yaw)) <= half + angularRadius;
    }
    case 'ring': {
      if (!withinHeight(v.origin, capsule)) return false;
      const { dist } = horizontalDistanceAndYaw(v.origin, capsule);
      const inner = Math.max(0, v.radius - v.width);
      return dist + capsule.radius >= inner && dist - capsule.radius <= v.radius;
    }
    case 'line': {
      if (!withinHeight(v.origin, capsule)) return false;
      const dir = directionFromYaw(v.yaw);
      const to = horizontal(sub(capsule.feet, v.origin));
      const along = dot(to, dir);
      if (along + capsule.radius < 0 || along - capsule.radius > v.length) return false;
      const side = distance(to, scale(dir, along));
      return side <= v.width / 2 + capsule.radius;
    }
  }
}

/** VFX 用: 体積からカプセル表面へ向かう最近接点。 */
export function volumeContactPoint(v: HitVolume, capsule: Capsule): Vec3 {
  switch (v.type) {
    case 'sphere':
      return closestPointOnCapsuleToSphere(v.center, capsule);
    case 'fan':
    case 'ring':
    case 'line': {
      const center = add(capsule.feet, vec3(0, capsule.height / 2, 0));
      const toOrigin = horizontal(sub(v.origin, center));
      const dir = toOrigin.x === 0 && toOrigin.z === 0 ? directionFromYaw(0) : normalize(toOrigin);
      return add(center, scale(dir, capsule.radius));
    }
  }
}
