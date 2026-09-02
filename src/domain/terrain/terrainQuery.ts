import type { Vec3 } from '../math/vec3';

// 地形コリジョンへの問い合わせ(domain が定義し infrastructure が three-mesh-bvh で実装する)。
// domain のロジックはこのインターフェースだけを知り、メッシュや BVH の詳細を知らない。

export interface TerrainHit {
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly distance: number;
  /** 面に「登攀不可」属性があるか */
  readonly unclimbable: boolean;
}

export interface CapsuleShape {
  readonly radius: number;
  /** 半球を含む全長 */
  readonly height: number;
}

export interface CapsuleContact {
  readonly normal: Vec3;
  readonly depth: number;
}

export interface CapsuleMoveResult {
  /** 押し出し後の足元位置 */
  readonly position: Vec3;
  /** 押し出しに使った接触面の法線(接触なしは空) */
  readonly contacts: readonly CapsuleContact[];
}

export interface TerrainQuery {
  /** 原点から方向 dir(単位ベクトル)へ maxDistance までレイキャストする。 */
  raycast(origin: Vec3, dir: Vec3, maxDistance: number): TerrainHit | null;
  /** 足元位置 feet のカプセルを地形と重ならない位置へ押し出す。 */
  resolveCapsule(feet: Vec3, shape: CapsuleShape): CapsuleMoveResult;
}
