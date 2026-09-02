import * as THREE from 'three';
import { degToRad } from '../../domain/config/gameConfig';
import type { StageLayout, StagePrimitive } from '../../domain/stage/stageLayout';

// ステージ配置(domain/stage)から描画用メッシュとコリジョン用ジオメトリを生成する(F05)。
// コリジョン用は 1 つの BufferGeometry にまとめ、三角形ごとに「登攀不可」属性を持つ。

export interface StageGeometry {
  /** 描画用グループ(不可視の外周壁は含まない) */
  readonly visual: THREE.Group;
  /** コリジョン用の結合ジオメトリ(ワールド座標)。頂点属性 `unclimbable`(1 = 登攀不可)を持つ */
  readonly collision: THREE.BufferGeometry;
}

export const UNCLIMBABLE_ATTRIBUTE = 'unclimbable';

const GROUND_COLOR = '#6f8a5f';

function primitiveGeometry(p: StagePrimitive): THREE.BufferGeometry {
  switch (p.kind) {
    case 'box': {
      const g = new THREE.BoxGeometry(p.size.x, p.size.y, p.size.z);
      const m = new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(p.pitch ?? 0, p.yaw ?? 0, 0),
      );
      m.setPosition(p.center.x, p.center.y, p.center.z);
      g.applyMatrix4(m);
      return g;
    }
    case 'cylinder': {
      const g = new THREE.CylinderGeometry(p.radius, p.radius, p.height, 24);
      g.translate(p.center.x, p.center.y, p.center.z);
      return g;
    }
    case 'ramp':
      return rampGeometry(p);
  }
}

/** 斜度 slopeDeg・高さ height の坂(直角三角柱)。base が底辺の中心、yaw 方向へ登る。 */
function rampGeometry(p: Extract<StagePrimitive, { kind: 'ramp' }>): THREE.BufferGeometry {
  const run = p.height / Math.tan(degToRad(p.slopeDeg));
  const hw = p.width / 2;
  // ローカル座標: +z 方向へ登る。底辺は z = 0、頂上は z = run
  const v = [
    [-hw, 0, 0],
    [hw, 0, 0],
    [hw, p.height, run],
    [-hw, p.height, run],
    [-hw, 0, run],
    [hw, 0, run],
  ];
  // 外向きの法線になる反時計回りの頂点順
  const faces = [
    [0, 2, 1],
    [0, 3, 2], // 斜面(上・−z 向き)
    [4, 5, 2],
    [4, 2, 3], // 背面(垂直、+z 向き)
    [0, 1, 5],
    [0, 5, 4], // 底面
    [0, 4, 3], // 左側面(−x)
    [1, 2, 5], // 右側面(+x)
  ];
  const positions: number[] = [];
  for (const f of faces) for (const i of f) positions.push(...(v[i] ?? []));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  const m = new THREE.Matrix4().makeRotationY(p.yaw);
  m.setPosition(p.base.x, p.base.y, p.base.z);
  g.applyMatrix4(m);
  return g;
}

function groundGeometry(size: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(size, size);
  g.rotateX(-Math.PI / 2);
  return g;
}

function toNonIndexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return g.index ? g.toNonIndexed() : g;
}

function stageMaterial(color: string): THREE.Material {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

export function buildStageGeometry(layout: StageLayout): StageGeometry {
  const visual = new THREE.Group();
  visual.name = 'stage';
  const parts: { geometry: THREE.BufferGeometry; unclimbable: boolean }[] = [];

  const ground = groundGeometry(layout.groundSize);
  parts.push({ geometry: toNonIndexed(ground), unclimbable: true });
  const groundMesh = new THREE.Mesh(ground, stageMaterial(GROUND_COLOR));
  groundMesh.receiveShadow = true;
  groundMesh.name = 'ground';
  visual.add(groundMesh);

  for (const p of layout.primitives) {
    const geometry = toNonIndexed(primitiveGeometry(p));
    parts.push({ geometry, unclimbable: !p.climbable });
    if (p.kind === 'box' && p.invisible) continue;
    const mesh = new THREE.Mesh(geometry, stageMaterial(p.color ?? '#808080'));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = p.name;
    visual.add(mesh);
  }

  const positions: number[] = [];
  const unclimbable: number[] = [];
  for (const part of parts) {
    const attr = part.geometry.getAttribute('position');
    for (let i = 0; i < attr.count; i++) {
      positions.push(attr.getX(i), attr.getY(i), attr.getZ(i));
      unclimbable.push(part.unclimbable ? 1 : 0);
    }
  }
  const collision = new THREE.BufferGeometry();
  collision.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  collision.setAttribute(UNCLIMBABLE_ATTRIBUTE, new THREE.Float32BufferAttribute(unclimbable, 1));
  return { visual, collision };
}
