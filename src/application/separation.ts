import type { Vec3 } from '../domain/math/vec3';

// カプセル同士の分離処理(F04)。水平方向のみ。比率は双方 50%、ダミーは 0%(不動)。
export interface Separable {
  readonly position: Vec3;
  readonly radius: number;
  /** 移動比率(0 で不動) */
  readonly weight: number;
  /** 高さ(重なりの判定に使う) */
  readonly height: number;
}

export function separatePair(a: Separable, b: Separable): { a: Vec3; b: Vec3 } {
  const dx = b.position.x - a.position.x;
  const dz = b.position.z - a.position.z;
  const dist = Math.hypot(dx, dz);
  const minDist = a.radius + b.radius;
  const verticalOverlap =
    a.position.y < b.position.y + b.height && b.position.y < a.position.y + a.height;
  if (dist >= minDist || !verticalOverlap) return { a: a.position, b: b.position };
  const total = a.weight + b.weight;
  if (total === 0) return { a: a.position, b: b.position };
  const nx = dist === 0 ? 1 : dx / dist;
  const nz = dist === 0 ? 0 : dz / dist;
  const push = minDist - dist;
  const ra = push * (a.weight / total);
  const rb = push * (b.weight / total);
  return {
    a: { x: a.position.x - nx * ra, y: a.position.y, z: a.position.z - nz * ra },
    b: { x: b.position.x + nx * rb, y: b.position.y, z: b.position.z + nz * rb },
  };
}
