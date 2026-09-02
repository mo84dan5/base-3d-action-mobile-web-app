import { degToRad, type CombatConfig } from '../config/gameConfig';
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

// 攻撃の当たり判定(F04)。攻撃側の球と被弾側のカプセルの重なりで判定する。
export interface Capsule {
  /** 足元(カプセル最下点) */
  readonly feet: Vec3;
  readonly radius: number;
  /** 半球を含む全長 */
  readonly height: number;
}

export function capsuleCenter(c: Capsule): Vec3 {
  return add(c.feet, vec3(0, c.height / 2, 0));
}

/** カプセル内部の線分(半球の中心同士)の端点。 */
function capsuleSegment(c: Capsule): { readonly a: Vec3; readonly b: Vec3 } {
  const a = add(c.feet, vec3(0, c.radius, 0));
  const b = add(c.feet, vec3(0, c.height - c.radius, 0));
  return { a, b };
}

function closestPointOnSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = sub(b, a);
  const abLen2 = dot(ab, ab);
  if (abLen2 === 0) return a;
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / abLen2));
  return add(a, scale(ab, t));
}

export function sphereCapsuleOverlap(
  sphereCenter: Vec3,
  sphereRadius: number,
  capsule: Capsule,
): boolean {
  const { a, b } = capsuleSegment(capsule);
  const closest = closestPointOnSegment(sphereCenter, a, b);
  return distance(closest, sphereCenter) <= sphereRadius + capsule.radius;
}

/** VFX 用: 球とカプセル表面の最近接点。 */
export function closestPointOnCapsuleToSphere(sphereCenter: Vec3, capsule: Capsule): Vec3 {
  const { a, b } = capsuleSegment(capsule);
  const axisPoint = closestPointOnSegment(sphereCenter, a, b);
  const toSphere = sub(sphereCenter, axisPoint);
  const dir = normalize(toSphere);
  return add(axisPoint, scale(dir, capsule.radius));
}

/** 攻撃側の正面 forwardDistance m・高さ heightOffset の位置(当たり判定球の中心)。 */
export function attackSpherePosition(
  attackerFeet: Vec3,
  attackerYaw: number,
  forwardDistance: number,
  heightOffset = 0.85,
): Vec3 {
  const forward = scale(directionFromYaw(attackerYaw), forwardDistance);
  return add(add(attackerFeet, forward), vec3(0, heightOffset, 0));
}

export interface TargetCandidate {
  readonly id: number;
  readonly feet: Vec3;
  readonly hp: number;
}

/** 正面 ±30 度・3.0 m 以内で最も近い敵の方向(ヨー)。該当なしは null。 */
export function targetCorrectionYaw(
  playerFeet: Vec3,
  playerYaw: number,
  enemies: readonly TargetCandidate[],
  config: CombatConfig,
): number | null {
  const halfAngle = degToRad(config.targetCorrectionHalfAngleDeg);
  let best: { yaw: number; dist: number } | null = null;
  for (const enemy of enemies) {
    if (enemy.hp <= 0) continue;
    const toEnemy = horizontal(sub(enemy.feet, playerFeet));
    const dist = Math.hypot(toEnemy.x, toEnemy.z);
    if (dist === 0 || dist > config.targetCorrectionRange) continue;
    const yaw = yawFromDirection(toEnemy);
    if (Math.abs(wrapAngle(yaw - playerYaw)) > halfAngle) continue;
    if (best === null || dist < best.dist) best = { yaw, dist };
  }
  return best === null ? null : best.yaw;
}

/** ノックバック方向: 攻撃側中心 → 被弾側中心の水平単位ベクトル。ゼロなら被弾側の背面方向。 */
export function horizontalKnockbackDirection(
  attackerCenter: Vec3,
  victimCenter: Vec3,
  victimYaw: number,
): Vec3 {
  const h = horizontal(sub(victimCenter, attackerCenter));
  if (h.x === 0 && h.z === 0) return scale(directionFromYaw(victimYaw), -1);
  return normalize(h);
}
