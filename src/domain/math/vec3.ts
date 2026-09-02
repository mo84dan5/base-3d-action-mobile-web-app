// Three.js に依存しない 3 次元ベクトル(不変値)。domain / application 層で使う。
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const ZERO3: Vec3 = { x: 0, y: 0, z: 0 };
export const UP: Vec3 = { x: 0, y: 1, z: 0 };

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len === 0 ? ZERO3 : scale(a, 1 / len);
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** 水平成分(y = 0)だけを取り出す。 */
export function horizontal(a: Vec3): Vec3 {
  return { x: a.x, y: 0, z: a.z };
}

export function horizontalLength(a: Vec3): number {
  return Math.hypot(a.x, a.z);
}

/** ヨー角(ラジアン。+z を 0 とし、+x 方向へ正)から水平の単位ベクトルを返す。 */
export function directionFromYaw(yaw: number): Vec3 {
  return { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
}

/** 水平ベクトルからヨー角(ラジアン)を返す。ゼロベクトルは 0。 */
export function yawFromDirection(d: Vec3): number {
  if (d.x === 0 && d.z === 0) return 0;
  return Math.atan2(d.x, d.z);
}

/** ベクトル v から法線 n 方向の成分を取り除く(壁ずり)。 */
export function removeComponentAlong(v: Vec3, n: Vec3): Vec3 {
  return sub(v, scale(n, dot(v, n)));
}

/** 角度差を [-π, π] に正規化する。 */
export function wrapAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/** 現在角 from を目標角 to へ最大 maxDelta だけ近づける。 */
export function rotateTowards(from: number, to: number, maxDelta: number): number {
  const diff = wrapAngle(to - from);
  if (Math.abs(diff) <= maxDelta) return to;
  return from + Math.sign(diff) * maxDelta;
}

export function approximately(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 値 current を target へ加速度 accel × dt の範囲で近づける(速度補間)。 */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}
