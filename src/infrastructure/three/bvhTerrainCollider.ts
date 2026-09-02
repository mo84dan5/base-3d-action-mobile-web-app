import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Vec3 } from '../../domain/math/vec3';
import { UNCLIMBABLE_ATTRIBUTE } from './stageGeometry';
import type {
  CapsuleContact,
  CapsuleMoveResult,
  CapsuleShape,
  TerrainHit,
  TerrainQuery,
} from '../../domain/terrain/terrainQuery';

// three-mesh-bvh によるカプセル対メッシュ判定(F05 衝突判定の実装方針)。
// 「登攀不可」属性は頂点属性(stageGeometry の UNCLIMBABLE_ATTRIBUTE)から読む(BVH が三角形を並べ替えても壊れない)。

const MAX_ITERATIONS = 4;

export class BvhTerrainCollider implements TerrainQuery {
  private readonly bvh: MeshBVH;
  private readonly ray = new THREE.Ray();
  private readonly segment = new THREE.Line3();
  private readonly box = new THREE.Box3();
  private readonly triPoint = new THREE.Vector3();
  private readonly segPoint = new THREE.Vector3();
  private readonly delta = new THREE.Vector3();
  private readonly triNormal = new THREE.Vector3();

  private readonly unclimbable: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null;

  constructor(geometry: THREE.BufferGeometry) {
    this.bvh = new MeshBVH(geometry);
    this.unclimbable = geometry.getAttribute(UNCLIMBABLE_ATTRIBUTE) ?? null;
  }

  raycast(origin: Vec3, dir: Vec3, maxDistance: number): TerrainHit | null {
    this.ray.origin.set(origin.x, origin.y, origin.z);
    this.ray.direction.set(dir.x, dir.y, dir.z).normalize();
    const hit = this.bvh.raycastFirst(this.ray, THREE.FrontSide, 0, maxDistance);
    if (!hit || hit.distance > maxDistance || !hit.face) return null;
    const n = hit.face.normal;
    return {
      point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
      normal: { x: n.x, y: n.y, z: n.z },
      distance: hit.distance,
      unclimbable: this.unclimbable ? this.unclimbable.getX(hit.face.a) >= 0.5 : false,
    };
  }

  resolveCapsule(feet: Vec3, shape: CapsuleShape): CapsuleMoveResult {
    const position = new THREE.Vector3(feet.x, feet.y, feet.z);
    const contacts: CapsuleContact[] = [];
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const push = this.pushOutOnce(position, shape);
      if (!push) break;
      position.add(push.normal.clone().multiplyScalar(push.depth));
      if (iteration === 0 || push.depth > 1e-4) {
        contacts.push({
          normal: { x: push.normal.x, y: push.normal.y, z: push.normal.z },
          depth: push.depth,
        });
      }
    }
    return { position: { x: position.x, y: position.y, z: position.z }, contacts };
  }

  /** 最も深く貫入している三角形からの押し出しを 1 回求める。 */
  private pushOutOnce(
    feet: THREE.Vector3,
    shape: CapsuleShape,
  ): { normal: THREE.Vector3; depth: number } | null {
    const r = shape.radius;
    this.segment.start.set(feet.x, feet.y + r, feet.z);
    this.segment.end.set(feet.x, feet.y + shape.height - r, feet.z);
    this.box.makeEmpty();
    this.box.expandByPoint(this.segment.start);
    this.box.expandByPoint(this.segment.end);
    this.box.min.addScalar(-r);
    this.box.max.addScalar(r);
    let bestDepth = 0;
    const bestNormal = new THREE.Vector3();
    this.bvh.shapecast({
      intersectsBounds: (box) => box.intersectsBox(this.box),
      intersectsTriangle: (tri) => {
        const dist = tri.closestPointToSegment(this.segment, this.triPoint, this.segPoint);
        if (dist >= r) return false;
        const depth = r - dist;
        this.delta.subVectors(this.segPoint, this.triPoint);
        if (this.delta.lengthSq() < 1e-12) {
          tri.getNormal(this.triNormal);
          this.delta.copy(this.triNormal);
        }
        this.delta.normalize();
        // 面の法線と押し出し方向が逆(裏側から)なら法線側へ押す
        tri.getNormal(this.triNormal);
        if (this.delta.dot(this.triNormal) < 0) this.delta.copy(this.triNormal);
        if (depth > bestDepth) {
          bestDepth = depth;
          bestNormal.copy(this.delta);
        }
        return false;
      },
    });
    if (bestDepth <= 1e-6) return null;
    return { normal: bestNormal, depth: bestDepth };
  }
}
