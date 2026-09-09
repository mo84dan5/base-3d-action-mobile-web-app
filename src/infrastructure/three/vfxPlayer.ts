import * as THREE from 'three';
import type { EffectEvent } from '../../application/effects';
import type { EffectPort } from '../../application/ports';
import type { ViewState } from '../../application/viewState';
import type { GameConfig } from '../../domain/config/gameConfig';
import type { AttackKind } from '../../domain/hitReaction/hitTables';
import type { EquipmentSlot } from '../../domain/equipment/equipment';
import type { Vec3 } from '../../domain/math/vec3';
import { findAttackStyle } from '../../domain/attackStyle/attackStyleCatalog';
import type { HitVolume } from '../../domain/combat/hitVolume';
import { qualityPreset, type Quality, type QualityPreset } from '../../domain/settings/settings';
import { meleeVisualOf, shotVisualOf } from './weaponVisual';

// VFX プレイヤー(デザインディレクション エフェクト)。ローポリ・フラットシェード、ポリゴンの形だけで作る。
// プールから取得し、色ごとに 1 マテリアル、粒は InstancedMesh でまとめる。寿命はワールド時間で進む(F10)。

const COLORS = {
  white: '#FFFFFF',
  cyan: '#8FE3FF',
  uiCyan: '#4FD1FF',
  yellow: '#FFD166',
  orange: '#FF6B35',
  magenta: '#FF3D81',
  red: '#E5333F',
  darkRed: '#8A1C25',
  grey: '#E6EEF5',
  patrolBody: '#7a4b9e',
  dummyBody: '#b8a680',
} as const;

type ColorName = keyof typeof COLORS;

const STEP = 1 / 60;

interface Timed {
  age: number;
  life: number;
}

interface MeshEffect extends Timed {
  mesh: THREE.Mesh;
  update: (t: number, mesh: THREE.Mesh, dt: number) => void;
}

interface Particle extends Timed {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  scale: number;
  gravity: boolean;
  groundY: number;
  rotation: THREE.Euler;
}

class ParticleSystem {
  readonly mesh: THREE.InstancedMesh;
  readonly particles: Particle[] = [];
  private readonly dummy = new THREE.Object3D();

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    readonly capacity: number,
  ) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  spawn(p: Particle): void {
    if (this.particles.length >= this.capacity) this.particles.shift();
    this.particles.push(p);
  }

  update(dt: number, gravity: number, fade: (p: Particle) => number): void {
    for (const p of this.particles) {
      p.age += dt;
      if (p.gravity) p.velocity.y -= gravity * dt;
      p.position.addScaledVector(p.velocity, dt);
      if (p.gravity && p.position.y <= p.groundY) p.age = p.life;
    }
    let i = 0;
    for (const p of this.particles) {
      if (p.age >= p.life) continue;
      const s = p.scale * fade(p);
      this.dummy.position.copy(p.position);
      this.dummy.rotation.copy(p.rotation);
      this.dummy.scale.setScalar(Math.max(0.0001, s));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      i++;
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    for (let k = this.particles.length - 1; k >= 0; k--) {
      const p = this.particles[k];
      if (p && p.age >= p.life) this.particles.splice(k, 1);
    }
  }

  get active(): number {
    return this.particles.length;
  }
}

/**
 * 斬撃の帯(扇形)。ローカル XY 平面上の弧(中心 +X、中心角 angleDeg)を、内径側を +Z(上)、外径側を −Z に
 * ずらした円錐状の帯にする。平板だと背後のカメラから真横(エッジオン)になって見えないため、高さを持たせて
 * 振りの軌跡として読めるようにする。先端に向けて幅を絞る(デザインディレクション「斬撃」)。
 */
function fanGeometry(
  innerR: number,
  outerR: number,
  angleDeg: number,
  segments = 10,
  innerLift = 0.3,
  outerDrop = -0.25,
  taper = true,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const half = (angleDeg * Math.PI) / 360;
  const push = (a: number, r: number, z: number) => {
    positions.push(r * Math.cos(a), r * Math.sin(a), z);
  };
  for (let i = 0; i < segments; i++) {
    const a0 = -half + (i / segments) * half * 2;
    const a1 = -half + ((i + 1) / segments) * half * 2;
    const taper0 = taper ? 1 - Math.abs(a0) / half / 2 : 1;
    const taper1 = taper ? 1 - Math.abs(a1) / half / 2 : 1;
    const o0 = outerR * (0.6 + 0.4 * taper0);
    const o1 = outerR * (0.6 + 0.4 * taper1);
    // 三角形 2 枚(表裏は DoubleSide で描く)
    push(a0, innerR, innerLift);
    push(a0, o0, outerDrop);
    push(a1, o1, outerDrop);
    push(a0, innerR, innerLift);
    push(a1, o1, outerDrop);
    push(a1, innerR, innerLift);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

function groundFanGeometry(radius: number, angleDeg: number, segments = 12): THREE.BufferGeometry {
  const positions: number[] = [];
  const half = (angleDeg * Math.PI) / 360;
  for (let i = 0; i < segments; i++) {
    const a0 = -half + (i / segments) * half * 2;
    const a1 = -half + ((i + 1) / segments) * half * 2;
    positions.push(
      0,
      0,
      0,
      radius * Math.sin(a1),
      0,
      radius * Math.cos(a1),
      radius * Math.sin(a0),
      0,
      radius * Math.cos(a0),
    );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return g;
}

function sparkGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, -0.025, 0, 0.4, 0, 0, 0, 0.025, 0], 3),
  );
  return g;
}

/** 矢(武器別の言語): ローカル +Y へ向く。軸(幅 0.05 m)+ 三角の鏃 + 2 枚の矢羽。全長 1.0 m、中心が原点。 */
function arrowGeometry(): THREE.BufferGeometry {
  const L = 1.0;
  const w = 0.025;
  const positions: number[] = [];
  const quad = (x0: number, y0: number, x1: number, y1: number) => {
    positions.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0);
  };
  const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
    positions.push(ax, ay, 0, bx, by, 0, cx, cy, 0);
  };
  quad(-w, -L / 2, w, L / 2 - 0.12);
  tri(-0.07, L / 2 - 0.16, 0.07, L / 2 - 0.16, 0, L / 2);
  tri(-w, -L / 2 + 0.22, -w, -L / 2, -0.1, -L / 2 - 0.03);
  tri(w, -L / 2, w, -L / 2 + 0.22, 0.1, -L / 2 - 0.03);
  return crossedPlanes(positions);
}

/** XY 平面の三角形列を、Y 軸回りに 90 度回した複製と合わせた十字板にする(背後のカメラから薄板が消えないように)。 */
function crossedPlanes(positions: number[]): THREE.BufferGeometry {
  const doubled = positions.slice();
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] ?? 0;
    const y = positions[i + 1] ?? 0;
    doubled.push(0, y, x);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(doubled, 3));
  g.computeVertexNormals();
  return g;
}

/** 槍の突き(武器別の言語): ローカル +Y へ伸びる柄(幅 0.06 m)+ 三角の穂先(幅 0.12 m、長さ 0.25 m)。原点が手元。 */
function spearGeometry(length: number): THREE.BufferGeometry {
  const w = 0.04;
  const tip = Math.min(0.25, length * 0.3);
  const shaft = length - tip;
  const positions: number[] = [];
  const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
    positions.push(ax, ay, 0, bx, by, 0, cx, cy, 0);
  };
  tri(-w, 0, w, 0, w, shaft);
  tri(-w, 0, w, shaft, -w, shaft);
  tri(-0.08, shaft, 0.08, shaft, 0, length);
  return crossedPlanes(positions);
}

/** 筋・細線・突きの線に使う細い棒(どの角度からも見える)。 */
function rodGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(1, 1, 1);
}

const UP_AXIS = new THREE.Vector3(0, 1, 0);
/** 槍・拳の突きを前方からわずかに上へ向ける角度。背後のカメラで長さが読めるようにする */
const SPEAR_PITCH = (14 * Math.PI) / 180;
const JAB_PITCH = (12 * Math.PI) / 180;

/**
 * 斬撃の板の向き。ローカル X → 前方(yaw)、ローカル Y → 前方から見て右、ローカル Z → 上 の基底に、
 * 前方軸回りの roll(1 段 +45 度、2 段 −45 度、3 段 0、空中・強攻撃 90 度)を掛け、最後に yaw で世界へ向ける。
 */
export function slashOrientation(yaw: number, roll: number): THREE.Quaternion {
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
  );
  const q = new THREE.Quaternion().setFromRotationMatrix(basis);
  q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
  q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
  return q;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeIn(t: number): number {
  return t * t;
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** 技の出所(F12 / エフェクト.md): 右腕は右手(右 0.35 m)、左腕は左手、頭は頭の正面(高さ 1.5 m) */
interface TechniqueOrigin {
  /** 右 +1 / 左 −1 / 中央 0 */
  readonly side: number;
  readonly height: number;
}
const RIGHT_HAND: TechniqueOrigin = { side: 1, height: 1.05 };
function techniqueOrigin(slot: EquipmentSlot | null): TechniqueOrigin {
  if (slot === 'leftArm') return { side: -1, height: 1.05 };
  if (slot === 'head') return { side: 0, height: 1.5 };
  return RIGHT_HAND;
}
/** カプセル中心(判定の始点)からパーツ側へのずらし。forward は射線方向(水平成分だけ使う) */
const CAPSULE_CENTER_HEIGHT = 0.85;
function techniqueOffset(origin: TechniqueOrigin, forward: THREE.Vector3): THREE.Vector3 {
  const f = new THREE.Vector3(forward.x, 0, forward.z);
  if (f.lengthSq() < 1e-6) f.set(0, 0, 1);
  f.normalize();
  const right = new THREE.Vector3(-f.z, 0, f.x);
  return right.multiplyScalar(0.3 * origin.side).setY(origin.height - CAPSULE_CENTER_HEIGHT);
}

export class VfxPlayer implements EffectPort {
  readonly group = new THREE.Group();
  private readonly materials = new Map<string, THREE.MeshBasicMaterial>();
  private readonly effects: MeshEffect[] = [];
  private readonly pools = new Map<string, THREE.Mesh[]>();
  private preset: QualityPreset;
  private readonly sparks: ParticleSystem;
  private readonly shards: ParticleSystem;
  private readonly dust: ParticleSystem;
  private readonly windLines: ParticleSystem;
  private readonly afterimages: THREE.Mesh[] = [];
  private afterimageQueue: { position: THREE.Vector3; yaw: number; delay: number }[] = [];
  private readonly telegraphs: THREE.Mesh[] = [];
  private readonly interactRing: THREE.Mesh;
  private readonly chargeRing: THREE.Mesh;
  private chargeFullTime = 0;
  private readonly enemyAttacking = new Map<number, boolean>();
  private dim = 0;
  private windTimer = 0;
  private time = 0;

  constructor(
    private readonly config: GameConfig,
    quality: Quality,
    private readonly playerGeometry: THREE.BufferGeometry,
  ) {
    this.group.name = 'vfx';
    this.preset = qualityPreset(quality);
    this.sparks = new ParticleSystem(sparkGeometry(), this.material('white', true), 48);
    this.shards = new ParticleSystem(
      new THREE.TetrahedronGeometry(0.15),
      this.material('orange'),
      64,
    );
    this.dust = new ParticleSystem(
      new THREE.IcosahedronGeometry(0.15, 0),
      this.material('grey', false, 0.5),
      64,
    );
    this.windLines = new ParticleSystem(
      new THREE.PlaneGeometry(2, 0.02),
      this.material('grey', false, 0.4),
      12,
    );
    this.group.add(this.sparks.mesh, this.shards.mesh, this.dust.mesh, this.windLines.mesh);
    for (let i = 0; i < 3; i++) {
      const fan = new THREE.Mesh(
        groundFanGeometry(this.config.enemy.attackDistance + 0.1, 90),
        this.material('red', false, 0.5),
      );
      fan.visible = false;
      fan.name = 'vfx_enemy_telegraph_fan';
      this.telegraphs.push(fan);
      this.group.add(fan);
    }
    this.interactRing = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 0.93, 24),
      this.material('uiCyan'),
    );
    this.interactRing.rotation.x = -Math.PI / 2;
    this.interactRing.visible = false;
    this.interactRing.name = 'vfx_interact_ring';
    this.group.add(this.interactRing);
    // タメのチャージリング(デザインディレクション: 足元、半径 1.5 → 0.6、シアン → 白)
    this.chargeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1.0, 32),
      this.material('uiCyan').clone(),
    );
    this.chargeRing.rotation.x = -Math.PI / 2;
    this.chargeRing.visible = false;
    this.chargeRing.name = 'vfx_charge_ring';
    this.group.add(this.chargeRing);
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(this.playerGeometry, this.material('grey', false, 0.5));
      m.visible = false;
      m.name = 'vfx_dash_afterimage';
      this.afterimages.push(m);
      this.group.add(m);
    }
  }

  setQuality(quality: Quality): void {
    this.preset = qualityPreset(quality);
  }

  /** 背景の明度を落とす量(0〜0.4)。バースト発動時 0.3 秒。 */
  sceneDim(): number {
    return this.dim;
  }

  /** デバッグ用: 予算の内訳。 */
  budgetInfo(): Record<string, number> {
    return {
      limit: this.preset.vfxMeshLimit,
      effects: this.effects.length,
      sparks: this.sparks.active,
      shards: this.shards.active,
      dust: this.dust.active,
      wind: this.windLines.active,
    };
  }

  activeMeshCount(): number {
    return (
      this.effects.length +
      this.sparks.active +
      this.shards.active +
      this.dust.active +
      this.windLines.active
    );
  }

  private material(color: ColorName, additive = false, opacity = 1): THREE.MeshBasicMaterial {
    const key = `${color}:${additive ? 'add' : 'normal'}:${opacity}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        color: COLORS[color],
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      this.materials.set(key, m);
    }
    return m;
  }

  private acquire(key: string, factory: () => THREE.Mesh): THREE.Mesh {
    const pool = this.pools.get(key) ?? [];
    this.pools.set(key, pool);
    const free = pool.find((m) => !m.visible);
    if (free) return free;
    const mesh = factory();
    mesh.name = key;
    mesh.visible = false;
    pool.push(mesh);
    this.group.add(mesh);
    return mesh;
  }

  private play(
    key: string,
    factory: () => THREE.Mesh,
    life: number,
    update: MeshEffect['update'],
  ): THREE.Mesh {
    const mesh = this.acquire(key, factory);
    const own = mesh.material as THREE.MeshBasicMaterial;
    mesh.material = own;
    mesh.visible = true;
    mesh.scale.setScalar(1);
    this.effects.push({ mesh, age: 0, life, update });
    this.enforceBudget();
    return mesh;
  }

  private enforceBudget(): void {
    while (this.activeMeshCount() > this.preset.vfxMeshLimit && this.effects.length > 0) {
      const oldest = this.effects.shift();
      if (oldest) oldest.mesh.visible = false;
    }
  }

  private particleCount(n: number): number {
    return Math.max(2, Math.round(n * this.preset.particleMultiplier));
  }

  trigger(event: EffectEvent): void {
    switch (event.kind) {
      case 'attackSwing':
        this.attackSwing(
          event.attack,
          event.position,
          event.yaw,
          event.action,
          event.styleId,
          event.shape,
          event.slot,
        );
        break;
      case 'attackVolume':
        this.attackVolume(event.attack, event.volume, event.styleId);
        break;
      case 'projectileLaunch':
        this.dustPuff(event.position, 2, 0.1);
        break;
      case 'explosion':
        this.ring(event.position, 'orange', event.radius);
        this.shardBurst(event.position, 6, 'orange');
        this.dustPuff(event.position, 6, 0.3);
        break;
      case 'fieldPulse':
        this.ring(event.position, 'uiCyan', event.radius);
        break;
      case 'placed':
        this.ring(event.position, 'uiCyan', Math.max(0.6, Math.min(event.radius, 2.0)));
        this.dustPuff(event.position, 3, 0.15);
        break;
      case 'placedExpire':
        this.dustPuff(event.position, 3, 0.15);
        break;
      case 'summon':
        this.ring(event.position, 'cyan', 1.2);
        break;
      case 'summonStrike':
        this.ring(event.position, 'cyan', Math.max(0.6, event.radius));
        this.spark('light', event.position);
        break;
      case 'summonExpire':
        this.dustPuff(event.position, 2, 0.1);
        break;
      case 'guard':
        if (event.phase === 'success') {
          this.ring(event.position, 'white', 1.2);
          this.spark('heavy', {
            x: event.position.x + Math.sin(event.yaw) * 0.7,
            y: event.position.y + 0.85,
            z: event.position.z + Math.cos(event.yaw) * 0.7,
          });
        }
        break;
      case 'buff':
        this.buffRing(event.effect, event.position, event.radius, event.duration);
        break;
      case 'maneuver':
        this.afterimageQueue.push({
          position: new THREE.Vector3(event.position.x, event.position.y, event.position.z),
          yaw: Math.atan2(event.direction.x, event.direction.z),
          delay: 0,
        });
        this.dustPuff(event.position, 3, 0.15);
        break;
      case 'blink':
        this.dustPuff(event.from, 4, 0.2);
        this.ring(event.to, 'white', 1.0);
        this.dustPuff(event.to, 4, 0.2);
        break;
      case 'pull':
        this.tracer(event.from, event.to, false, 0);
        break;
      case 'selfDamage':
        this.ring(event.position, 'orange', 1.5);
        this.shardBurst(event.position, 8, 'orange');
        break;
      case 'hitSpark':
        this.spark(event.attack, event.position);
        break;
      case 'tracer':
        this.tracer(
          event.from,
          event.to,
          event.charged,
          event.chargeRatio,
          event.styleId,
          event.slot,
        );
        break;
      case 'muzzleFlash':
        this.muzzleFlash(event.position, event.yaw, event.styleId, event.slot);
        break;
      case 'lunge':
        this.afterimageQueue.push({
          position: new THREE.Vector3(event.position.x, event.position.y, event.position.z),
          yaw: event.yaw,
          delay: 0,
        });
        this.afterimageQueue.push({
          position: new THREE.Vector3(event.position.x, event.position.y, event.position.z),
          yaw: event.yaw,
          delay: 0.05,
        });
        this.dustPuff(event.position, 3, 0.15);
        break;
      case 'burstActivate':
        this.burst(event.position);
        break;
      case 'enemyDefeat':
        this.shardBurst(
          event.position,
          8,
          event.enemyKind === 'dummy' ? 'dummyBody' : 'patrolBody',
        );
        break;
      case 'playerDefeat':
        break;
      case 'dash':
        this.afterimageQueue.push({
          position: new THREE.Vector3(event.position.x, event.position.y, event.position.z),
          yaw: event.yaw,
          delay: 0,
        });
        this.afterimageQueue.push({
          position: new THREE.Vector3(event.position.x, event.position.y, event.position.z),
          yaw: event.yaw,
          delay: 0.05,
        });
        this.dustPuff(event.position, 3, 0.15);
        break;
      case 'jump':
        this.dustPuff(event.position, 5, 0.2);
        break;
      case 'land':
        this.dustPuff(event.position, event.heavy ? 8 : 5, event.heavy ? 0.4 : 0.2);
        break;
      case 'sprintDust':
        this.dustPuff(event.position, 3, 0.15);
        break;
      case 'climbAttach':
      case 'mantle':
        this.dustPuff(event.position, 5, 0.2);
        break;
      case 'interact':
        this.ring(event.position, 'uiCyan', 1.5);
        break;
      default:
        break;
    }
  }

  /** スタイル行動の発生時の表現(デザインディレクション「武器別の言語」)。 */
  private attackSwing(
    kind: AttackKind,
    position: Vec3,
    yaw: number,
    action: string | null,
    styleId: string | null,
    shape: 'sphere' | 'fan' | 'ring' | 'line' | null,
    slot: EquipmentSlot | null,
  ): void {
    const origin = techniqueOrigin(slot);
    const category = styleId ? findAttackStyle(styleId)?.category : undefined;
    // 銃火器・弓投擲の発射は銃口・矢・発射体が語るので、剣術の帯は出さない
    if (category === 'firearm' || category === 'ranged') return;
    // 1 行動 1 形: 扇・リング・直線の判定は attackVolume が形を描くので、振りは出さない
    if (shape === 'fan' || shape === 'ring' || shape === 'line') return;
    const visual = meleeVisualOf(styleId);
    const heavy = kind === 'heavy' || kind === 'huge' || kind === 'strongAttack';
    if (action === 'lunge' && visual !== 'slash' && visual !== 'spear' && visual !== 'sweep') {
      this.dustPuff(position, 4, 0.2);
      return;
    }
    switch (visual) {
      case 'fist':
        this.jab(position, yaw, heavy, origin);
        return;
      case 'hammer':
        this.smash(position, yaw, kind, origin);
        return;
      case 'staff':
        this.sweepBand(position, yaw, 1.0, 1.8, 150, 'grey', 8 / 60);
        return;
      case 'spear':
        this.spearThrust(position, yaw, heavy ? 2.6 : 2.0, origin);
        return;
      case 'sweep':
        this.sweepBand(position, yaw, 1.2, heavy ? 2.5 : 2.0, 180, 'cyan', 10 / 60);
        return;
      case 'impact':
        // 打撃: 足元の衝撃波リング。重い区分ほど大きい
        this.ring(position, 'white', kind === 'huge' ? 2.2 : kind === 'heavy' ? 1.6 : 1.0);
        this.dustPuff(position, 3, 0.15);
        return;
      case 'magic':
        this.ring(position, 'yellow', 1.2);
        return;
      case 'slash':
        this.slash(kind, position, yaw);
        return;
    }
  }

  /**
   * 拳: 右肩(右 0.35 m・高さ 1.05 m)から正面へ長さ 0.7 m・太さ 0.12 m の白い突きの棒。先端に火花 3 粒。
   * 背後のカメラから体に隠れないよう右へ寄せる。重い区分は足元に白リング。
   */
  private jab(position: Vec3, yaw: number, heavy: boolean, origin: TechniqueOrigin): void {
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x).multiplyScalar(origin.side);
    const dir = forward.clone().setY(Math.tan(JAB_PITCH)).normalize();
    const len = 0.7;
    const mesh = this.play(
      'vfx_jab_line',
      () => new THREE.Mesh(rodGeometry(), this.material('white')),
      8 / 60,
      (t, m) => {
        const grow = 0.3 + 0.7 * easeOut(clamp01(t / 0.4));
        m.scale.set(0.12, len * grow, 0.12);
        (m.material as THREE.MeshBasicMaterial).opacity = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
      },
    );
    mesh.position
      .set(position.x, position.y + 1.05, position.z)
      .addScaledVector(right, 0.35)
      .addScaledVector(dir, 0.65);
    mesh.quaternion.setFromUnitVectors(UP_AXIS, dir);
    mesh.material = this.material('white').clone();
    const tip = new THREE.Vector3(position.x, position.y + 1.05, position.z)
      .addScaledVector(right, 0.35)
      .addScaledVector(dir, 1.0);
    this.sparkAt(tip, 3);
    if (heavy) this.ring(position, 'white', 1.2);
  }

  /**
   * 槌: 右 0.4 m・高さ 1.5 m を支点に幅 0.35 m・高さ 1.6 m の白灰の板が -60 度 → +20 度に振り下ろされ、
   * 着地(正面 1 m)で地面リング + 破片 + ダスト。支点を右上に置き、背後のカメラから振りが見えるようにする。
   */
  private smash(position: Vec3, yaw: number, kind: AttackKind, origin: TechniqueOrigin): void {
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x).multiplyScalar(origin.side);
    const mesh = this.play(
      'vfx_smash_slab',
      () => new THREE.Mesh(new THREE.PlaneGeometry(0.35, 1.6), this.material('grey')),
      10 / 60,
      (t, m) => {
        const swing = easeIn(clamp01(t / 0.6));
        m.rotation.order = 'YXZ';
        m.rotation.set((-60 + 80 * swing) * (Math.PI / 180), yaw, 0);
        (m.material as THREE.MeshBasicMaterial).opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      },
    );
    mesh.position
      .set(position.x, position.y + 1.5, position.z)
      .addScaledVector(right, 0.4)
      .addScaledVector(forward, 0.5);
    mesh.material = this.material('grey').clone();
    const impact = { x: position.x + forward.x, y: position.y, z: position.z + forward.z };
    this.ring(impact, 'white', kind === 'huge' ? 2.2 : kind === 'heavy' ? 2.0 : 1.6);
    this.shardBurst(impact, 4, 'grey');
    this.dustPuff(impact, 4, 0.25);
  }

  /** 棍・薙ぎ: 水平の薄い帯(内径 / 外径 / 中心角)。剣術の帯より薄く広い。 */
  private sweepBand(
    position: Vec3,
    yaw: number,
    inner: number,
    outer: number,
    angleDeg: number,
    color: ColorName,
    life: number,
  ): void {
    const mesh = this.play(
      `vfx_sweep_${color}_${outer}_${angleDeg}`,
      () =>
        new THREE.Mesh(
          fanGeometry(
            inner,
            outer,
            angleDeg,
            angleDeg >= 360 ? 24 : 12,
            0.05,
            -0.05,
            angleDeg < 360,
          ),
          this.material(color),
        ),
      life,
      (t, m) => {
        m.scale.setScalar(easeOut(clamp01(t / 0.3)));
        (m.material as THREE.MeshBasicMaterial).opacity = t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6;
      },
    );
    mesh.position.set(position.x, position.y + 0.85, position.z);
    mesh.quaternion.copy(slashOrientation(yaw, 0));
    mesh.material = this.material(color).clone();
  }

  /**
   * 槍: 右手(右 0.35 m・高さ 1.05 m)から、幅 0.06 m・長さ = リーチの柄 + 三角の穂先が 0.6 m 前へ押し出される。
   * 背後のカメラから体に隠れないよう右へ寄せる。
   */
  private spearThrust(
    position: Vec3,
    yaw: number,
    length: number,
    origin: TechniqueOrigin = RIGHT_HAND,
  ): void {
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const hand = new THREE.Vector3(
      position.x,
      position.y + origin.height,
      position.z,
    ).addScaledVector(right, 0.35 * origin.side);
    const dir = forward.clone().setY(Math.tan(SPEAR_PITCH)).normalize();
    const mesh = this.play(
      `vfx_spear_thrust_${length}`,
      () => new THREE.Mesh(spearGeometry(length), this.material('cyan')),
      9 / 60,
      (t, m) => {
        const push = 0.6 * easeOut(clamp01(t / 0.6));
        m.position.copy(hand).addScaledVector(dir, push - 0.3);
        (m.material as THREE.MeshBasicMaterial).opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      },
    );
    mesh.position.copy(hand).addScaledVector(dir, -0.3);
    mesh.quaternion.setFromUnitVectors(UP_AXIS, dir);
    mesh.material = this.material('cyan').clone();
  }

  private sparkAt(position: THREE.Vector3, count: number): void {
    const n = this.particleCount(count);
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).normalize();
      this.sparks.spawn({
        age: 0,
        life: 0.2,
        position: position.clone(),
        velocity: dir.clone().multiplyScalar(0.6),
        scale: 0.8,
        gravity: false,
        groundY: -Infinity,
        rotation: new THREE.Euler(0, Math.atan2(dir.x, dir.z), Math.asin(dir.y)),
      });
    }
  }

  /**
   * 扇・リング・直線の判定を描く(1 行動 1 形)。近接系統(剣術・打撃・長柄・移動連動・防御)は武器型で
   * 胸の高さの帯(扇・リング)や突き(直線)にし、魔法風・特殊・設置は判定の形をそのまま地面と正面に描く。
   */
  private attackVolume(_kind: AttackKind, volume: HitVolume, styleId: string | null): void {
    const category = styleId ? findAttackStyle(styleId)?.category : undefined;
    const melee =
      category === 'sword' ||
      category === 'strike' ||
      category === 'polearm' ||
      category === 'movement' ||
      category === 'defense';
    if (melee && volume.type !== 'sphere') {
      const feet = { x: volume.origin.x, y: volume.origin.y - 0.85, z: volume.origin.z };
      const bandColor: ColorName =
        category === 'strike' ? 'grey' : category === 'polearm' ? 'cyan' : 'white';
      switch (volume.type) {
        case 'fan':
          this.sweepBand(
            feet,
            volume.yaw,
            Math.max(0.5, volume.radius * 0.55),
            volume.radius,
            volume.angleDeg,
            bandColor,
            8 / 60,
          );
          return;
        case 'ring':
          this.sweepBand(
            feet,
            0,
            Math.max(0.5, volume.radius * 0.55),
            volume.radius,
            360,
            bandColor,
            8 / 60,
          );
          return;
        case 'line':
          if (category === 'polearm') this.spearThrust(feet, volume.yaw, volume.length);
          else this.thrust(feet, volume.yaw, volume.length, volume.width);
          return;
      }
    }
    const color: ColorName =
      category === 'magic' ? 'yellow' : category === 'special' ? 'orange' : 'cyan';
    switch (volume.type) {
      case 'fan': {
        const mesh = this.play(
          `vfx_volume_fan_${color}`,
          () =>
            new THREE.Mesh(
              groundFanGeometry(1.0, volume.angleDeg),
              this.material(color, false, 0.5),
            ),
          0.25,
          (t, m) => {
            m.scale.setScalar(volume.radius * easeOut(clamp01(t / 0.3)));
            (m.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - t);
          },
        );
        mesh.position.set(volume.origin.x, volume.origin.y - 0.8, volume.origin.z);
        mesh.rotation.set(0, volume.yaw, 0);
        mesh.material = this.material(color, false, 0.5).clone();
        return;
      }
      case 'ring':
        this.ring(
          { x: volume.origin.x, y: volume.origin.y - 0.85, z: volume.origin.z },
          color,
          volume.radius,
        );
        return;
      case 'line':
        this.thrust(
          { x: volume.origin.x, y: volume.origin.y - 0.85, z: volume.origin.z },
          volume.yaw,
          volume.length,
          volume.width,
        );
        return;
      case 'sphere':
        this.ring(
          { x: volume.center.x, y: volume.center.y - 0.85, z: volume.center.z },
          color,
          volume.radius,
        );
        return;
    }
  }

  /** 長柄の突き: 幅 0.05 m、長さ = リーチの細長い線。 */
  private thrust(position: Vec3, yaw: number, length: number, width = 0.05): void {
    const mesh = this.play(
      'vfx_thrust_line',
      () => new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material('cyan')),
      0.15,
      (t, m) => {
        (m.material as THREE.MeshBasicMaterial).opacity = 1 - easeIn(t);
      },
    );
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    mesh.position
      .set(position.x, position.y + 0.85, position.z)
      .addScaledVector(forward, length / 2 + 0.3);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), forward);
    mesh.scale.set(Math.max(width, 0.05), length, 1);
    mesh.material = this.material('cyan').clone();
  }

  /** 一時的な能力変化の表現。時間停止はシアンの大きなリングが縮み、挑発は黄のリングが広がる。 */
  private buffRing(effect: string, position: Vec3, radius: number, duration: number): void {
    switch (effect) {
      case 'timeStop':
        this.shrinkRing(position, 'uiCyan', Math.max(1, radius), Math.min(0.6, duration));
        this.dim = 0.2;
        return;
      case 'taunt':
        this.ring(position, 'yellow', Math.max(1, radius));
        return;
      case 'damageReduction':
        this.ring(position, 'white', 1.2);
        return;
      case 'rhythm':
      case 'momentum':
      default:
        this.ring(position, 'cyan', 0.8);
    }
  }

  private slash(
    kind: AttackKind,
    position: { x: number; y: number; z: number },
    yaw: number,
  ): void {
    const outer =
      kind === 'normal3' || kind === 'medium'
        ? 1.6
        : kind === 'enemyAttack'
          ? 1.0
          : kind === 'strongAttack' || kind === 'heavy'
            ? 1.8
            : kind === 'huge'
              ? 2.2
              : 1.4;
    const color: ColorName = kind === 'enemyAttack' ? 'red' : 'white';
    // 前方軸回りの傾き。背後のカメラから見て 1 段は右上 → 左下、2 段は左上 → 右下、3 段は水平、空中・強攻撃は縦
    const roll =
      kind === 'normal1' || kind === 'light'
        ? -Math.PI / 4
        : kind === 'normal2'
          ? Math.PI / 4
          : kind === 'airAttack' || kind === 'strongAttack' || kind === 'heavy' || kind === 'huge'
            ? Math.PI / 2
            : 0;
    const mesh = this.play(
      `vfx_${kind}_slash_${outer}`,
      () => new THREE.Mesh(fanGeometry(0.6, outer, 120), this.material(color)),
      0.15,
      (t, m) => {
        const appear = clamp01(t / (2 / 9));
        m.scale.setScalar(easeOut(appear));
        (m.material as THREE.MeshBasicMaterial).opacity =
          t < 0.33 ? 1 : 1 - easeIn((t - 0.33) / 0.67);
      },
    );
    // 扇形はローカル XY 平面に弧の中心が +X を向くよう作られている。
    // 振りの軌跡として見せるため、ローカル X を前方、ローカル Z を上に向ける(水平斬りは水平面)。
    // 斜め・縦斬りは前方軸回りに roll だけ傾ける。弧の中心はプレイヤー(当たり判定球 0.6〜1.4 m に重なる)。
    mesh.position.set(position.x, position.y + 0.85, position.z);
    mesh.quaternion.copy(slashOrientation(yaw, roll));
    mesh.material = this.material(color).clone();
  }

  private spark(kind: AttackKind, position: { x: number; y: number; z: number }): void {
    const count = this.particleCount(
      kind === 'normal3' ||
        kind === 'strongAttack' ||
        kind === 'chargedShot' ||
        kind === 'heavy' ||
        kind === 'huge'
        ? 6
        : 4,
    );
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).normalize();
      this.sparks.spawn({
        age: 0,
        life: 0.2,
        position: new THREE.Vector3(position.x, position.y, position.z),
        velocity: dir.clone().multiplyScalar(0.5),
        scale: 0.8 + Math.random() * 0.5,
        gravity: false,
        groundY: -Infinity,
        rotation: new THREE.Euler(0, Math.atan2(dir.x, dir.z), Math.asin(dir.y)),
      });
    }
    if (kind === 'normal3' || kind === 'medium') this.ring(position, 'cyan', 1.0);
    if (kind === 'strongAttack' || kind === 'heavy') this.ring(position, 'cyan', 1.5);
    if (kind === 'huge') this.ring(position, 'cyan', 2.0);
  }

  /**
   * 射線の表現(武器別の言語)。弾・散弾・連射・ダーツは「射線上を飛ぶ筋」、狙撃と針は「残る細線」、
   * ビームは「幅のある帯 + 加算の芯」、矢は「飛んで刺さる矢」。設置物・召喚体の射線は弾。
   */
  private tracer(
    from: Vec3,
    to: Vec3,
    charged: boolean,
    chargeRatio: number,
    styleId?: string,
    slot?: EquipmentSlot,
  ): void {
    const b = new THREE.Vector3(to.x, to.y, to.z);
    // 見た目の始点はスロットのパーツ側(F12)。判定の始点 from は変えない
    const a = new THREE.Vector3(from.x, from.y, from.z).add(
      techniqueOffset(
        techniqueOrigin(slot ?? null),
        b.clone().sub(new THREE.Vector3(from.x, from.y, from.z)),
      ),
    );
    if (a.distanceTo(b) < 0.05) return;
    const ground = { x: to.x, y: to.y - 0.8, z: to.z };
    const visual = shotVisualOf(styleId);
    // 背後のカメラでは射線方向に飛ぶ物体が点にしか見えないため、飛ぶ型には射線全体の薄い残線を 2 ステップ敷く
    if (
      visual === 'bullet' ||
      visual === 'rapid' ||
      visual === 'pellet' ||
      visual === 'arrow' ||
      visual === 'dart'
    ) {
      this.line(a, b, visual === 'dart' ? 'magenta' : 'white', 0.02, 2 / 60, 'trace');
    }
    switch (visual) {
      case 'beam':
        this.line(a, b, 'cyan', 0.2, 4 / 60, 'beam');
        this.line(a, b, 'white', 0.06, 4 / 60, 'beam_core', true);
        this.ring(ground, 'uiCyan', 0.3);
        return;
      case 'arrow':
        this.arrow(a, b, charged, chargeRatio);
        return;
      case 'needle':
        this.line(a, b, 'white', 0.02, 2 / 60, 'needle');
        this.sparkAt(b, 2);
        return;
      case 'dart':
        this.streak(a, b, 'magenta', 0.06, 0.25, 30, 'dart');
        this.ring(ground, 'magenta', 0.3);
        return;
      case 'pellet':
        this.streak(a, b, 'white', 0.08, 0.4, 60, 'pellet');
        return;
      case 'rapid':
        this.streak(a, b, 'white', 0.06, 0.3, 60, 'rapid');
        return;
      case 'precise':
        if (charged) {
          this.chargedLine(a, b, chargeRatio);
          return;
        }
        this.line(a, b, 'white', 0.03, 8 / 60, 'precise');
        this.streak(a, b, 'white', 0.05, 0.6, 50, 'precise');
        return;
      case 'stamina':
        this.line(a, b, 'yellow', 0.03, 4 / 60, 'stamina');
        this.streak(a, b, 'yellow', 0.05, 0.6, 50, 'stamina');
        return;
      case 'bullet':
        if (charged) {
          this.chargedLine(a, b, chargeRatio);
          return;
        }
        this.streak(a, b, 'white', 0.05, 0.6, 50, 'bullet');
        return;
    }
  }

  /** 射線全体に残る細線。 */
  private line(
    a: THREE.Vector3,
    b: THREE.Vector3,
    color: ColorName,
    width: number,
    life: number,
    key: string,
    additive = false,
  ): void {
    const length = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    const mesh = this.play(
      `vfx_shot_line_${key}`,
      () => new THREE.Mesh(rodGeometry(), this.material(color, additive)),
      life,
      (t, m) => {
        (m.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      },
    );
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP_AXIS, dir);
    mesh.scale.set(width, length, width);
    mesh.material = this.material(color, additive).clone();
  }

  /** 射線上を飛ぶ短い筋。長さ len m の板が speed m/s で from → to へ進み、着弾で消える。 */
  private streak(
    a: THREE.Vector3,
    b: THREE.Vector3,
    color: ColorName,
    width: number,
    len: number,
    speed: number,
    key: string,
  ): void {
    const total = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    const life = Math.max(3 / 60, total / speed);
    const mesh = this.play(
      `vfx_shoot_tracer_${key}`,
      () => new THREE.Mesh(rodGeometry(), this.material(color)),
      life,
      (t, m) => {
        const head = Math.min(total, speed * t * life);
        const visible = Math.min(head, len);
        m.position.copy(a).addScaledVector(dir, head - visible / 2);
        m.scale.set(width, Math.max(0.01, visible), width);
        (m.material as THREE.MeshBasicMaterial).opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      },
    );
    mesh.position.copy(a);
    mesh.quaternion.setFromUnitVectors(UP_AXIS, dir);
    mesh.material = this.material(color).clone();
  }

  /** タメ打ち: 幅 0.12 m の淡シアン + 加算の白い芯を 12 ステップ。 */
  private chargedLine(a: THREE.Vector3, b: THREE.Vector3, chargeRatio: number): void {
    this.line(a, b, 'cyan', 0.12, 12 / 60, 'charged');
    this.line(a, b, 'white', 0.04 + 0.02 * chargeRatio, 12 / 60, 'charged_core', true);
  }

  /** 矢: 30 m/s で飛び、着弾点に 0.3 秒刺さって消える。タメの狙い撃ちは 1.4 倍・淡シアンの軌跡。 */
  private arrow(a: THREE.Vector3, b: THREE.Vector3, charged: boolean, chargeRatio: number): void {
    const total = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    const speed = 30;
    const flight = total / speed;
    const life = flight + 0.3;
    const color: ColorName = charged ? 'cyan' : 'white';
    const mesh = this.play(
      charged ? 'vfx_arrow_charged' : 'vfx_arrow',
      () => new THREE.Mesh(arrowGeometry(), this.material(color)),
      life,
      (t, m) => {
        const head = Math.min(total, speed * t * life);
        m.position.copy(a).addScaledVector(dir, head - 0.5);
        m.scale.setScalar(charged ? 1.4 : 1);
        const stuck = clamp01((t * life - flight) / 0.25);
        (m.material as THREE.MeshBasicMaterial).opacity = 1 - easeIn(stuck);
      },
    );
    mesh.position.copy(a);
    mesh.quaternion.setFromUnitVectors(UP_AXIS, dir);
    mesh.material = this.material(color).clone();
    if (charged) this.line(a, b, 'cyan', 0.03 + 0.03 * chargeRatio, 6 / 60, 'arrow_trail');
  }

  /**
   * 銃口の表現(武器別の言語)。弾・狙撃・スタミナ弾は 4 本の三角形、散弾は 6 本を広角に、連射は 3 本 + 薬莢、
   * ビームは銃口のリング、矢・針・ダーツは出さない。狙撃は白灰の煙を足す。
   */
  private muzzleFlash(position: Vec3, yaw: number, styleId?: string, slot?: EquipmentSlot): void {
    const visual = shotVisualOf(styleId);
    if (visual === 'arrow' || visual === 'needle' || visual === 'dart') return;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    // 銃口の出所(F12): 右腕は右手、左腕は左手、頭は頭の正面。判定の始点(position)は変えない
    const muzzle = new THREE.Vector3(position.x, position.y, position.z)
      .addScaledVector(forward, 0.5)
      .add(techniqueOffset(techniqueOrigin(slot ?? null), forward));
    if (visual === 'beam') {
      const ring = this.play(
        'vfx_muzzle_ring',
        () => new THREE.Mesh(new THREE.RingGeometry(0.6, 1.0, 16), this.material('uiCyan')),
        3 / 60,
        (t, m) => {
          m.scale.setScalar(0.3 * (1 + 0.5 * t));
          (m.material as THREE.MeshBasicMaterial).opacity = 1 - t;
        },
      );
      ring.position.copy(muzzle);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), forward);
      ring.material = this.material('uiCyan').clone();
      return;
    }
    const count = visual === 'pellet' ? 6 : visual === 'rapid' ? 3 : 4;
    const spreadSpeed = visual === 'pellet' ? 1.4 : visual === 'rapid' ? 0.6 : 0.8;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.PI / 4;
      const spread = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0).applyAxisAngle(
        UP_AXIS,
        yaw,
      );
      this.sparks.spawn({
        age: 0,
        life: 0.1,
        position: muzzle.clone(),
        velocity: spread.clone().multiplyScalar(spreadSpeed),
        scale: visual === 'rapid' ? 0.35 : 0.5,
        gravity: false,
        groundY: -Infinity,
        rotation: new THREE.Euler(0, Math.atan2(spread.x, spread.z), Math.asin(spread.y)),
      });
    }
    if (visual === 'rapid') {
      // 薬莢: 右へ弾いて重力で落ちる白灰の粒
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      this.dust.spawn({
        age: 0,
        life: 0.6,
        position: muzzle.clone().addScaledVector(forward, -0.4),
        velocity: right.multiplyScalar(1.5).add(new THREE.Vector3(0, 1.8, 0)),
        scale: 0.3,
        gravity: true,
        groundY: position.y - 0.85,
        rotation: new THREE.Euler(Math.random() * 3, Math.random() * 3, 0),
      });
    }
    if (visual === 'precise')
      this.dustPuff({ x: muzzle.x, y: muzzle.y - 0.1, z: muzzle.z }, 2, 0.1);
  }

  private ring(
    position: { x: number; y: number; z: number },
    color: ColorName,
    radius: number,
  ): void {
    const mesh = this.play(
      `vfx_ring_${color}`,
      () => new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 32), this.material(color)),
      0.35,
      (t, m) => {
        const grow = clamp01(t / (6 / 21));
        m.scale.setScalar(Math.max(0.01, radius * easeOut(grow)));
        (m.material as THREE.MeshBasicMaterial).opacity = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7;
      },
    );
    mesh.position.set(position.x, position.y + 0.05, position.z);
    mesh.rotation.set(-Math.PI / 2, 0, 0);
    mesh.material = this.material(color).clone();
  }

  private shrinkRing(
    position: { x: number; y: number; z: number },
    color: ColorName,
    targetRadius: number,
    seconds: number,
  ): void {
    const mesh = this.play(
      `vfx_telegraph_ring_${color}`,
      () => new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 32), this.material(color)),
      seconds,
      (t, m) => {
        m.scale.setScalar(3.0 + (targetRadius - 3.0) * t);
        (m.material as THREE.MeshBasicMaterial).opacity = 0.9;
      },
    );
    mesh.position.set(position.x, position.y + 0.05, position.z);
    mesh.rotation.set(-Math.PI / 2, 0, 0);
    mesh.material = this.material(color).clone();
  }

  private burst(position: { x: number; y: number; z: number }): void {
    this.dim = 0.4;
    this.shrinkRing(
      position,
      'orange',
      this.config.combat.burst.radius,
      this.config.combat.burst.startup,
    );
    const startup = this.config.combat.burst.startup;
    const pillar = this.play(
      'vfx_burst_pillar',
      () =>
        new THREE.Mesh(
          new THREE.CylinderGeometry(0.6, 0.6, 6, 6, 1, true),
          this.material('orange', false, 0.7),
        ),
      1.0 + startup,
      (t, m) => {
        const local = Math.max(0, (t * (1.0 + startup) - startup) / 1.0);
        const rise = clamp01(local / (9 / 60));
        m.visible = local > 0;
        m.scale.set(1, Math.max(0.01, easeOut(rise)), 1);
        m.position.y = position.y + 3 * m.scale.y + (local > 29 / 60 ? (local - 29 / 60) * 8 : 0);
        (m.material as THREE.MeshBasicMaterial).opacity =
          local > 29 / 60 ? 0.7 * (1 - (local - 29 / 60) / (20 / 60)) : 0.7;
      },
    );
    pillar.position.set(position.x, position.y + 3, position.z);
    pillar.material = this.material('orange', false, 0.7).clone();
    const core = this.play(
      'vfx_burst_core',
      () =>
        new THREE.Mesh(
          new THREE.CylinderGeometry(0.15, 0.15, 6, 6, 1, true),
          this.material('white', true),
        ),
      1.0 + startup,
      (t, m) => {
        const local = Math.max(0, (t * (1.0 + startup) - startup) / 1.0);
        m.visible = local > 0;
        m.scale.set(1, Math.max(0.01, easeOut(clamp01(local / (9 / 60)))), 1);
        m.position.y = position.y + 3 * m.scale.y;
        (m.material as THREE.MeshBasicMaterial).opacity =
          local > 29 / 60 ? 1 - (local - 29 / 60) / (20 / 60) : 1;
      },
    );
    core.position.set(position.x, position.y + 3, position.z);
    core.material = this.material('white', true).clone();
    const ringDelay = this.play(
      'vfx_burst_ring_delay',
      () => new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 32), this.material('magenta')),
      startup + 0.35,
      (t, m) => {
        const local = Math.max(0, (t * (startup + 0.35) - startup) / 0.35);
        m.visible = local > 0;
        m.scale.setScalar(
          Math.max(0.01, this.config.combat.burst.radius * easeOut(clamp01(local / 0.57))),
        );
        (m.material as THREE.MeshBasicMaterial).opacity = local < 0.3 ? 1 : 1 - (local - 0.3) / 0.7;
      },
    );
    ringDelay.position.set(position.x, position.y + 0.05, position.z);
    ringDelay.rotation.set(-Math.PI / 2, 0, 0);
    ringDelay.material = this.material('magenta').clone();
    this.shardBurst(position, 12, 'orange');
  }

  private shardBurst(
    position: { x: number; y: number; z: number },
    count: number,
    color: ColorName,
  ): void {
    const n = this.particleCount(count);
    this.shards.mesh.material = this.material(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 3;
      this.shards.spawn({
        age: 0,
        life: 1.0,
        position: new THREE.Vector3(position.x, position.y + 0.5, position.z),
        velocity: new THREE.Vector3(
          Math.cos(a) * speed,
          4 + Math.random() * 4,
          Math.sin(a) * speed,
        ),
        scale: 0.7 + Math.random() * 0.9,
        gravity: true,
        groundY: position.y,
        rotation: new THREE.Euler(Math.random() * 3, Math.random() * 3, 0),
      });
    }
  }

  private dustPuff(
    position: { x: number; y: number; z: number },
    count: number,
    radius: number,
  ): void {
    const n = this.particleCount(count);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.dust.spawn({
        age: 0,
        life: 0.4,
        position: new THREE.Vector3(
          position.x + Math.cos(a) * radius * 0.5,
          position.y + 0.05,
          position.z + Math.sin(a) * radius * 0.5,
        ),
        velocity: new THREE.Vector3(Math.cos(a) * radius, 0.75, Math.sin(a) * radius),
        scale: 0.6 + Math.random() * 0.6,
        gravity: false,
        groundY: -Infinity,
        rotation: new THREE.Euler(),
      });
    }
  }

  /** 表示状態から継続的な演出(予兆・風の線・インタラクトのリング・敵の斬撃)を更新する。 */
  syncWithView(view: ViewState): void {
    let fanIndex = 0;
    for (const e of view.enemies) {
      const wasAttacking = this.enemyAttacking.get(e.id) ?? false;
      if (e.attacking && !wasAttacking) this.slash('enemyAttack', e.position, e.yaw);
      this.enemyAttacking.set(e.id, e.attacking);
      if (e.telegraphOpacity > 0 && fanIndex < this.telegraphs.length) {
        const fan = this.telegraphs[fanIndex++];
        if (!fan) continue;
        fan.visible = true;
        fan.position.set(e.position.x, e.position.y + 0.03, e.position.z);
        fan.rotation.set(0, e.yaw, 0);
        (fan.material as THREE.MeshBasicMaterial).opacity = e.telegraphOpacity;
      }
    }
    for (let i = fanIndex; i < this.telegraphs.length; i++) {
      const fan = this.telegraphs[i];
      if (fan) fan.visible = false;
    }
    const p = view.player;
    this.syncChargeRing(p);
    const hSpeed = Math.hypot(p.velocity.x, p.velocity.z);
    if (p.state === 'glide' && hSpeed >= 2 && this.windTimer <= 0) {
      this.windTimer = 0.12;
      this.spawnWindLines(p.position, p.velocity, hSpeed);
    }
    const target = view.hud.interactTargetPosition;
    this.interactRing.visible = target !== null && view.hud.phase !== 'ended';
    if (target) {
      this.interactRing.position.set(target.x, target.y, target.z);
      this.interactRing.position.y += 0.05 + 0.15 * (0.5 + 0.5 * Math.sin(this.time * 3));
    }
  }

  /** チャージリング: 半径 1.5 → 0.6 m に縮み、満タンで白へ。満タン後は 1 秒周期で明滅(3 Hz 未満)。 */
  private syncChargeRing(p: ViewState['player']): void {
    const ratio = p.chargeRatio;
    this.chargeRing.visible = ratio > 0;
    if (ratio <= 0) {
      this.chargeFullTime = 0;
      return;
    }
    const radius = 1.5 + (0.6 - 1.5) * ratio;
    this.chargeRing.position.set(p.position.x, p.position.y + 0.05, p.position.z);
    this.chargeRing.scale.setScalar(radius);
    const material = this.chargeRing.material as THREE.MeshBasicMaterial;
    if (ratio >= 1) {
      this.chargeFullTime += 1 / 60;
      const blink = 0.5 + 0.5 * Math.sin(this.chargeFullTime * Math.PI * 2);
      material.color.set(COLORS.white);
      material.opacity = 0.7 + 0.3 * blink;
      return;
    }
    material.color.set(COLORS.uiCyan).lerp(new THREE.Color(COLORS.white), ratio * 0.5);
    material.opacity = 0.9;
  }

  private spawnWindLines(
    position: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number },
    speed: number,
  ): void {
    const count = this.preset.windLineCount;
    const back = new THREE.Vector3(-velocity.x, 0, -velocity.z).normalize();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.5 + Math.random() * 1.0;
      this.windLines.spawn({
        age: 0,
        life: 0.3,
        position: new THREE.Vector3(
          position.x + Math.cos(a) * r,
          position.y + 0.5 + Math.random() * 1.2,
          position.z + Math.sin(a) * r,
        ),
        velocity: back.clone().multiplyScalar(speed * 1.5),
        scale: 0.75 + speed * 0.25,
        gravity: false,
        groundY: -Infinity,
        rotation: new THREE.Euler(0, Math.atan2(back.x, back.z) + Math.PI / 2, 0),
      });
    }
  }

  /** ワールド時間で進める(一時停止中は呼ばない)。 */
  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    this.windTimer -= dt;
    this.dim = Math.max(0, this.dim - dt * (0.4 / 0.3));
    for (const e of this.effects) {
      e.age += dt;
      e.update(clamp01(e.age / e.life), e.mesh, dt);
      if (e.age >= e.life) e.mesh.visible = false;
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      if (e && e.age >= e.life) this.effects.splice(i, 1);
    }
    this.sparks.update(dt, 0, (p) => 1 - Math.max(0, (p.age - 4 * STEP) / (8 * STEP)) * 0.3);
    this.shards.update(dt, this.config.physics.gravity, () => 1);
    this.dust.update(dt, 0, (p) => Math.max(0.05, 1 - easeOut(p.age / p.life)));
    this.windLines.update(dt, 0, (p) => 1 - p.age / p.life);
    this.updateAfterimages(dt);
  }

  private updateAfterimages(dt: number): void {
    for (const q of this.afterimageQueue) q.delay -= dt;
    const ready = this.afterimageQueue.filter((q) => q.delay <= 0);
    this.afterimageQueue = this.afterimageQueue.filter((q) => q.delay > 0);
    for (const q of ready) {
      if (this.preset.afterimageCount === 0) continue;
      const mesh = this.afterimages.find((m) => !m.visible) ?? this.afterimages[0];
      if (!mesh) continue;
      mesh.visible = true;
      mesh.position.copy(q.position);
      mesh.position.y += this.config.physics.playerCapsuleHeight / 2;
      mesh.rotation.set(0, q.yaw, 0);
      mesh.userData.age = 0;
      mesh.material = this.material('grey', false, 0.5).clone();
    }
    for (const m of this.afterimages) {
      if (!m.visible) continue;
      const age = ((m.userData.age as number | undefined) ?? 0) + dt;
      m.userData.age = age;
      (m.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - age / 0.3);
      if (age >= 0.3) m.visible = false;
    }
  }
}
