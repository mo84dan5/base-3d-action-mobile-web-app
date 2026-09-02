import { add, clamp, dot, length, normalize, scale, sub, vec3, type Vec3 } from '../math/vec3';
import type { CapsuleMoveResult, CapsuleShape, TerrainHit, TerrainQuery } from './terrainQuery';

// 解析的な形状(無限平面・軸平行の箱)による TerrainQuery の実装。
// 単体テストとステージの簡易検証に使う(本番の地形は infrastructure の BVH 実装)。

export interface PlaneShape {
  readonly kind: 'plane';
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly unclimbable?: boolean;
}

export interface BoxShape {
  readonly kind: 'box';
  readonly min: Vec3;
  readonly max: Vec3;
  readonly unclimbable?: boolean;
}

export type AnalyticShape = PlaneShape | BoxShape;

const EPS = 1e-9;

function rayPlane(
  origin: Vec3,
  dir: Vec3,
  plane: PlaneShape,
  maxDistance: number,
): TerrainHit | null {
  const denom = dot(dir, plane.normal);
  if (denom >= -EPS) return null; // 裏面・平行は無視
  const t = dot(sub(plane.point, origin), plane.normal) / denom;
  if (t < 0 || t > maxDistance) return null;
  return {
    point: add(origin, scale(dir, t)),
    normal: plane.normal,
    distance: t,
    unclimbable: plane.unclimbable ?? false,
  };
}

function rayBox(origin: Vec3, dir: Vec3, box: BoxShape, maxDistance: number): TerrainHit | null {
  let tMin = 0;
  let tMax = maxDistance;
  let hitNormal: Vec3 = vec3(0, 0, 0);
  const axes = ['x', 'y', 'z'] as const;
  for (const axis of axes) {
    const o = origin[axis];
    const d = dir[axis];
    const lo = box.min[axis];
    const hi = box.max[axis];
    if (Math.abs(d) < EPS) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    let n1 = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      n1 = 1;
    }
    if (t1 > tMin) {
      tMin = t1;
      hitNormal = vec3(axis === 'x' ? n1 : 0, axis === 'y' ? n1 : 0, axis === 'z' ? n1 : 0);
    }
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  if (tMin <= 0 || length(hitNormal) === 0) return null; // 内部からの開始は当たりなし
  return {
    point: add(origin, scale(dir, tMin)),
    normal: hitNormal,
    distance: tMin,
    unclimbable: box.unclimbable ?? false,
  };
}

function closestPointOnSegment(a: Vec3, b: Vec3, p: Vec3): Vec3 {
  const ab = sub(b, a);
  const t = clamp(dot(sub(p, a), ab) / Math.max(dot(ab, ab), EPS), 0, 1);
  return add(a, scale(ab, t));
}

function closestPointInBox(box: BoxShape, p: Vec3): Vec3 {
  return vec3(
    clamp(p.x, box.min.x, box.max.x),
    clamp(p.y, box.min.y, box.max.y),
    clamp(p.z, box.min.z, box.max.z),
  );
}

export class AnalyticTerrain implements TerrainQuery {
  constructor(private readonly shapes: readonly AnalyticShape[]) {}

  static flatGround(extra: readonly AnalyticShape[] = []): AnalyticTerrain {
    return new AnalyticTerrain([
      { kind: 'plane', point: vec3(0, 0, 0), normal: vec3(0, 1, 0) },
      ...extra,
    ]);
  }

  raycast(origin: Vec3, dir: Vec3, maxDistance: number): TerrainHit | null {
    let best: TerrainHit | null = null;
    for (const shape of this.shapes) {
      const hit =
        shape.kind === 'plane'
          ? rayPlane(origin, dir, shape, maxDistance)
          : rayBox(origin, dir, shape, maxDistance);
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    return best;
  }

  resolveCapsule(feet: Vec3, shape: CapsuleShape): CapsuleMoveResult {
    let position = feet;
    const contacts: { normal: Vec3; depth: number }[] = [];
    for (let iteration = 0; iteration < 3; iteration++) {
      let moved = false;
      for (const s of this.shapes) {
        const push =
          s.kind === 'plane'
            ? this.pushPlane(position, shape, s)
            : this.pushBox(position, shape, s);
        if (!push) continue;
        position = add(position, scale(push.normal, push.depth));
        if (iteration === 0) contacts.push(push);
        moved = true;
      }
      if (!moved) break;
    }
    return { position, contacts };
  }

  private segment(feet: Vec3, shape: CapsuleShape): [Vec3, Vec3] {
    return [
      add(feet, vec3(0, shape.radius, 0)),
      add(feet, vec3(0, shape.height - shape.radius, 0)),
    ];
  }

  private pushPlane(feet: Vec3, shape: CapsuleShape, plane: PlaneShape) {
    const [a, b] = this.segment(feet, shape);
    const da = dot(sub(a, plane.point), plane.normal);
    const db = dot(sub(b, plane.point), plane.normal);
    const d = Math.min(da, db);
    if (d >= shape.radius) return null;
    return { normal: plane.normal, depth: shape.radius - d };
  }

  private pushBox(feet: Vec3, shape: CapsuleShape, box: BoxShape) {
    const [a, b] = this.segment(feet, shape);
    let onSeg = closestPointOnSegment(a, b, closestPointInBox(box, scale(add(a, b), 0.5)));
    let onBox = closestPointInBox(box, onSeg);
    for (let i = 0; i < 3; i++) {
      onSeg = closestPointOnSegment(a, b, onBox);
      onBox = closestPointInBox(box, onSeg);
    }
    const diff = sub(onSeg, onBox);
    const dist = length(diff);
    if (dist >= shape.radius) return null;
    if (dist < EPS) {
      // 線分が箱の内部にある: 最も近い面へ押し出す
      const candidates = [
        { normal: vec3(-1, 0, 0), depth: onSeg.x - box.min.x },
        { normal: vec3(1, 0, 0), depth: box.max.x - onSeg.x },
        { normal: vec3(0, -1, 0), depth: onSeg.y - box.min.y },
        { normal: vec3(0, 1, 0), depth: box.max.y - onSeg.y },
        { normal: vec3(0, 0, -1), depth: onSeg.z - box.min.z },
        { normal: vec3(0, 0, 1), depth: box.max.z - onSeg.z },
      ];
      candidates.sort((p, q) => p.depth - q.depth);
      const best = candidates[0];
      if (!best) return null;
      return { normal: best.normal, depth: best.depth + shape.radius };
    }
    return { normal: normalize(diff), depth: shape.radius - dist };
  }
}
