// 2 次元ベクトル(スクリーン座標・スティック入力用)。
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const ZERO2: Vec2 = { x: 0, y: 0 };

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function length2(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function sub2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale2(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function normalize2(a: Vec2): Vec2 {
  const len = length2(a);
  return len === 0 ? ZERO2 : scale2(a, 1 / len);
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function rectContains(r: Rect, p: Vec2): boolean {
  return p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
}
