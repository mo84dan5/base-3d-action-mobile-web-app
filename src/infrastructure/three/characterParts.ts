import * as THREE from 'three';
import type { StyleCategory } from '../../domain/attackStyle/actionSpec';
import type { EquipmentSlot } from '../../domain/equipment/equipment';
import type { PartMotion } from '../../domain/player/partMotion';
import { effectiveLocomotion, type LocomotionType } from '../../domain/locomotion/locomotion';
import { CATEGORY_COLORS } from './styleVisuals';

// パーツ分けキャラクター(デザインディレクション キャラクター)。
// 胴 + 頭 + 右腕 + 左腕 + 右脚 + 左脚 を支点(首・肩・股)回りに回し、
// 頭・右腕・左腕には装備の系統に応じた付属物を付ける。脚は移動タイプ(F12)で差し替える脚グループ。原点は足元、+Z が正面。
// 画面上の「右」はプレイヤーから見た右 = 正面 +Z のとき −X。

const TORSO_COLOR = '#2E5DA1';
const HEAD_COLOR = '#5B8BD6';
const HAND_COLOR = '#E6EEF5';
const LEG_COLOR = '#243F73';
const EYE_COLOR = '#FFFFFF';
const FLASH_RED = new THREE.Color('#ff3b3b');

const DEG = Math.PI / 180;
/** 腕(押下)の最大角 */
const ARM_SWING_DEG = 95;
/** 腕(長押し)の保持角 */
const ARM_HOLD_DEG = 80;
const HEAD_NOD_DEG = 22;
const HEAD_HOLD_DEG = 15;
/** 技が終わったあと元に戻す時間(秒) */
const RETURN_SECONDS = 0.1;
/** 脚を 0 度へ戻す時間(秒) */
const LEG_RETURN_SECONDS = 0.15;
/** 頭の付属物の明滅(Hz)。3 Hz 未満 */
const HEAD_GLOW_HZ = 2;
/** 浮く珠・環の回転速度(rad/s) */
const ORBIT_SPIN = 1.2;

export const WALK_SPEED_LIMIT = 1.8;
const WALK = { amplitudeDeg: 22, hz: 1.5 };
const RUN = { amplitudeDeg: 35, hz: 2.5 };
const DASH_HZ = 3.0;

type Pivot = 'head' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg';
type LegPivot = 'rightLeg' | 'leftLeg';
type UpperPivot = Exclude<Pivot, LegPivot>;

/** 脚グループ(キャラクター.md 脚パーツと移動タイプ)。移動タイプが変わると丸ごと作り直す */
export interface LegRig {
  readonly locomotion: LocomotionType;
  readonly group: THREE.Group;
  readonly pivots: Readonly<Record<LegPivot, THREE.Group>>;
}

export interface CharacterParts {
  readonly root: THREE.Group;
  /** 倒れの傾きを掛ける胴以下の全体 */
  readonly figure: THREE.Group;
  readonly pivots: Readonly<Record<UpperPivot, THREE.Group>>;
  readonly attachments: Readonly<Record<EquipmentSlot, THREE.Group>>;
  /** 脚。`CharacterAnimator` が移動タイプに応じて差し替える */
  legs: LegRig;
}

interface MotionState {
  angles: Record<Pivot, number>;
  legPhase: number;
  spinTime: number;
  categories: Record<EquipmentSlot, StyleCategory | null>;
}

function lambert(color: string, opacity = 1): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true });
  if (opacity < 1) {
    m.transparent = true;
    m.opacity = opacity;
  }
  return m;
}

function box(w: number, h: number, d: number, color: string): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color));
  mesh.castShadow = true;
  return mesh;
}

/** +Z へ伸びる棒(円柱を倒す) */
function rodZ(radius: number, length: number, color: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 6),
    lambert(color),
  );
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function halfArc(radius: number, color: string): THREE.Mesh {
  return new THREE.Mesh(new THREE.TorusGeometry(radius, 0.02, 6, 12, Math.PI), lambert(color));
}

function ring(radius: number, color: string): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.015, 6, 16), lambert(color));
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function orb(radius: number, color: string): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 0), lambert(color));
  mesh.name = 'spin';
  return mesh;
}

function fin(height: number, color: string): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.04, height, 3), lambert(color));
  mesh.scale.z = 0.3;
  return mesh;
}

function at(mesh: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh {
  mesh.position.set(x, y, z);
  return mesh;
}

/** 腕の付属物(支点 = 肩。手先は y = −0.5 付近) */
function armAttachment(category: StyleCategory, color: string): THREE.Object3D[] {
  const hand = -0.5;
  switch (category) {
    case 'sword':
      return [at(box(0.06, 0.02, 0.55, color), 0, hand, 0.32)];
    case 'strike':
      return [at(box(0.18, 0.18, 0.18, color), 0, hand, 0.08)];
    case 'polearm': {
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.18, 4), lambert(color));
      tip.rotation.x = Math.PI / 2;
      return [at(rodZ(0.02, 0.9, color), 0, hand, 0.3), at(tip, 0, hand, 0.84)];
    }
    case 'firearm':
      return [
        at(rodZ(0.03, 0.35, color), 0, hand, 0.2),
        at(rodZ(0.045, 0.05, HAND_COLOR), 0, hand, 0.4),
      ];
    case 'ranged': {
      const bow = halfArc(0.28, color);
      bow.rotation.y = Math.PI / 2;
      bow.rotation.z = -Math.PI / 2;
      return [at(bow, 0, hand, 0.1)];
    }
    case 'magic':
      return [at(orb(0.09, color), 0, hand, 0.22)];
    case 'placement':
      return [
        at(box(0.16, 0.16, 0.16, color), 0, hand, 0.1),
        at(rodZ(0.01, 0.16, color), 0, hand + 0.16, 0.1),
      ];
    case 'defense':
      return [at(box(0.03, 0.42, 0.36, color), -0.1, hand + 0.15, 0.05)];
    case 'movement': {
      const f = fin(0.3, color);
      f.rotation.x = Math.PI;
      return [at(f, 0, hand + 0.2, -0.1)];
    }
    case 'special': {
      const r = ring(0.12, color);
      r.rotation.x = 0;
      return [at(r, 0, hand + 0.1, 0)];
    }
  }
}

/** 頭の付属物(支点 = 首。頭の中心は y = +0.18、上面は +0.33) */
function headAttachment(category: StyleCategory, color: string): THREE.Object3D[] {
  const top = 0.33;
  switch (category) {
    case 'sword':
      return [
        at(
          new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 4), lambert(color)),
          0,
          top + 0.11,
          0.1,
        ),
      ];
    case 'strike':
      return [at(box(0.36, 0.08, 0.36, color), 0, top + 0.04, 0)];
    case 'polearm':
      return [at(rodZ(0.02, 0.5, color), -0.22, 0.2, 0.05)];
    case 'firearm':
      return [at(rodZ(0.03, 0.25, color), 0, 0.2, 0.27)];
    case 'ranged': {
      const arc = halfArc(0.14, color);
      arc.rotation.y = Math.PI / 2;
      return [at(arc, 0, top, 0)];
    }
    case 'magic':
      return [at(orb(0.09, color), 0, top + 0.2, 0)];
    case 'placement':
      return [
        at(rodZ(0.01, 0.25, color), 0, top + 0.12, 0).rotateX(-Math.PI / 2),
        at(new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), lambert(color)), 0, top + 0.27, 0),
      ];
    case 'defense': {
      const mask = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.02), lambert(color, 0.5));
      return [at(mask, 0, 0.18, 0.2)];
    }
    case 'movement':
      return [at(fin(0.2, color), 0, top - 0.05, -0.2)];
    case 'special': {
      const r = ring(0.2, color);
      r.name = 'spin';
      return [at(r, 0, top + 0.08, 0)];
    }
  }
}

function pivot(root: THREE.Object3D, x: number, y: number, z: number, name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  root.add(g);
  return g;
}

export function buildCharacterParts(): CharacterParts {
  const root = new THREE.Group();
  root.name = 'player';
  const figure = new THREE.Group();
  figure.name = 'figure';
  root.add(figure);

  const torso = box(0.5, 0.62, 0.3, TORSO_COLOR);
  torso.name = 'torso';
  torso.position.set(0, 0.98, 0);
  figure.add(torso);

  const head = pivot(figure, 0, 1.32, 0, 'neck');
  head.add(at(box(0.34, 0.3, 0.34, HEAD_COLOR), 0, 0.18, 0));
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.02), lambert(EYE_COLOR));
  head.add(at(eye, 0, 0.2, 0.17));

  // 右腕はプレイヤーの右 = −X
  const rightArm = pivot(figure, -0.34, 1.26, 0, 'shoulderR');
  const leftArm = pivot(figure, 0.34, 1.26, 0, 'shoulderL');
  for (const arm of [rightArm, leftArm]) {
    arm.add(at(box(0.14, 0.44, 0.14, TORSO_COLOR), 0, -0.22, 0));
    arm.add(at(box(0.14, 0.12, 0.14, HAND_COLOR), 0, -0.5, 0));
  }
  const legs = buildLegs('biped');
  figure.add(legs.group);

  const attachment = (parent: THREE.Group, name: string) => {
    const g = new THREE.Group();
    g.name = name;
    parent.add(g);
    return g;
  };
  return {
    root,
    figure,
    pivots: { head, rightArm, leftArm },
    attachments: {
      head: attachment(head, 'attach_head'),
      rightArm: attachment(rightArm, 'attach_rightArm'),
      leftArm: attachment(leftArm, 'attach_leftArm'),
    },
    legs,
  };
}

/** 二足の脚: 股の支点 2 つに 0.16 × 0.62 × 0.18 の箱 */
function bipedLegs(group: THREE.Group): Record<LegPivot, THREE.Group> {
  const rightLeg = pivot(group, -0.13, 0.67, 0, 'hipR');
  const leftLeg = pivot(group, 0.13, 0.67, 0, 'hipL');
  for (const leg of [rightLeg, leftLeg]) leg.add(at(box(0.16, 0.62, 0.18, LEG_COLOR), 0, -0.31, 0));
  return { rightLeg, leftLeg };
}

/**
 * 移動タイプに応じた脚グループを作る(F12 脚スロットと移動タイプ)。
 * 実装済みは二足のみ。未実装のタイプは二足のパーツを使う(`effectiveLocomotion`)。
 */
export function buildLegs(locomotion: LocomotionType): LegRig {
  const group = new THREE.Group();
  group.name = 'legs';
  const effective = effectiveLocomotion(locomotion);
  // 将来ここに multiLeg / vehicle / tank / hover / flight の分岐を足す
  const pivots = bipedLegs(group);
  return { locomotion: effective, group, pivots };
}

export function meshCount(parts: CharacterParts): number {
  let n = 0;
  parts.root.traverse((o) => {
    if (o instanceof THREE.Mesh) n++;
  });
  return n;
}

function disposeObject(o: THREE.Object3D): void {
  if (o instanceof THREE.Mesh) {
    (o.geometry as THREE.BufferGeometry).dispose();
    const material: unknown = o.material;
    if (material instanceof THREE.Material) material.dispose();
  }
}

function disposeChildren(group: THREE.Group): void {
  for (const c of [...group.children]) {
    group.remove(c);
    disposeObject(c);
  }
}

function disposeTree(group: THREE.Group): void {
  group.traverse((o) => disposeObject(o));
  group.parent?.remove(group);
}

/** 押下の腕: 0 → −95 度(0.35 で最大。ease-out)→ 0(1.0。ease-in) */
export function armSwingAngle(progress: number, hold: boolean): number {
  if (hold) {
    if (progress < 0.2) return -ARM_HOLD_DEG * DEG * (progress / 0.2);
    if (progress < 0.85) return -ARM_HOLD_DEG * DEG;
    return -ARM_HOLD_DEG * DEG * (1 - (progress - 0.85) / 0.15);
  }
  if (progress < 0.35) {
    const t = progress / 0.35;
    return -ARM_SWING_DEG * DEG * (1 - (1 - t) * (1 - t));
  }
  const t = (progress - 0.35) / 0.65;
  return -ARM_SWING_DEG * DEG * (1 - t * t);
}

/** 頭: 押下は 0 → 22 度(0.3)→ 0(1.0)。長押しは 15 度を保持 */
export function headNodAngle(progress: number, hold: boolean): number {
  if (hold) return HEAD_HOLD_DEG * DEG;
  if (progress < 0.3) return HEAD_NOD_DEG * DEG * (progress / 0.3);
  return HEAD_NOD_DEG * DEG * (1 - (progress - 0.3) / 0.7);
}

function moveToward(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** 脚の振り(股の X 軸回り)。速度 0 / 空中では 0 へ戻す */
export function legSwing(speed: number, grounded: boolean, dashing: boolean) {
  if (!grounded || speed < 0.05) return null;
  if (speed <= WALK_SPEED_LIMIT) return WALK;
  return { amplitudeDeg: RUN.amplitudeDeg, hz: dashing ? DASH_HZ : RUN.hz };
}

export interface PlayerPose {
  readonly motion: PartMotion | null;
  /** 水平速度(m/s) */
  readonly speed: number;
  readonly grounded: boolean;
  readonly dashing: boolean;
  readonly equipment: Readonly<Record<EquipmentSlot, StyleCategory>>;
  /** 脚スロットの移動タイプ(F12)。未実装のタイプは二足として描く */
  readonly locomotion: LocomotionType;
  /** 被弾フラッシュ 0〜0.8 */
  readonly flashOpacity: number;
}

/** パーツの回転・付属物・フラッシュをフレームごとに更新する */
export class CharacterAnimator {
  private readonly state: MotionState = {
    angles: { head: 0, rightArm: 0, leftArm: 0, rightLeg: 0, leftLeg: 0 },
    legPhase: 0,
    spinTime: 0,
    categories: { head: null, rightArm: null, leftArm: null },
  };

  constructor(readonly parts: CharacterParts) {}

  update(pose: PlayerPose, dt: number): void {
    this.syncAttachments(pose.equipment);
    this.syncLegs(pose.locomotion);
    this.animateTechnique(pose.motion, dt);
    this.animateLegs(pose, dt);
    this.spinOrbits(dt);
    this.flash(pose.flashOpacity);
  }

  private syncAttachments(equipment: Readonly<Record<EquipmentSlot, StyleCategory>>): void {
    for (const slot of ['head', 'rightArm', 'leftArm'] as const) {
      const category = equipment[slot];
      if (this.state.categories[slot] === category) continue;
      this.state.categories[slot] = category;
      const group = this.parts.attachments[slot];
      disposeChildren(group);
      const color = CATEGORY_COLORS[category];
      const children =
        slot === 'head' ? headAttachment(category, color) : armAttachment(category, color);
      for (const c of children) group.add(c);
    }
  }

  /** 移動タイプが(実効的に)変わったときだけ脚グループを作り直す */
  private syncLegs(locomotion: LocomotionType): void {
    if (this.parts.legs.locomotion === effectiveLocomotion(locomotion)) return;
    disposeTree(this.parts.legs.group);
    const legs = buildLegs(locomotion);
    this.parts.figure.add(legs.group);
    this.parts.legs = legs;
    this.state.angles.rightLeg = 0;
    this.state.angles.leftLeg = 0;
  }

  private animateTechnique(motion: PartMotion | null, dt: number): void {
    const targets: Record<'head' | 'rightArm' | 'leftArm', number> = {
      head: 0,
      rightArm: 0,
      leftArm: 0,
    };
    if (motion) {
      targets[motion.part] =
        motion.part === 'head'
          ? headNodAngle(motion.progress, motion.hold)
          : armSwingAngle(motion.progress, motion.hold);
    }
    const returnRate = (ARM_SWING_DEG * DEG) / RETURN_SECONDS;
    for (const part of ['head', 'rightArm', 'leftArm'] as const) {
      const target = targets[part];
      const active = motion?.part === part;
      const next = active ? target : moveToward(this.state.angles[part], 0, returnRate * dt);
      this.state.angles[part] = next;
      this.parts.pivots[part].rotation.x = next;
    }
    this.glowHead(motion !== null && motion.part === 'head' && motion.hold, dt);
  }

  private glowHead(on: boolean, dt: number): void {
    this.state.spinTime += dt;
    const intensity = on
      ? 0.5 + 0.3 * Math.sin(this.state.spinTime * HEAD_GLOW_HZ * Math.PI * 2)
      : 0;
    this.parts.attachments.head.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshLambertMaterial) {
        o.material.emissive.copy(o.material.color).multiplyScalar(intensity);
      }
    });
  }

  private animateLegs(pose: PlayerPose, dt: number): void {
    const swing = legSwing(pose.speed, pose.grounded, pose.dashing);
    if (swing) {
      this.state.legPhase += dt * swing.hz * Math.PI * 2;
      const a = swing.amplitudeDeg * DEG * Math.sin(this.state.legPhase);
      this.state.angles.rightLeg = a;
      this.state.angles.leftLeg = -a;
    } else {
      const rate = (RUN.amplitudeDeg * DEG) / LEG_RETURN_SECONDS;
      this.state.angles.rightLeg = moveToward(this.state.angles.rightLeg, 0, rate * dt);
      this.state.angles.leftLeg = moveToward(this.state.angles.leftLeg, 0, rate * dt);
    }
    this.parts.legs.pivots.rightLeg.rotation.x = this.state.angles.rightLeg;
    this.parts.legs.pivots.leftLeg.rotation.x = this.state.angles.leftLeg;
  }

  private spinOrbits(dt: number): void {
    for (const group of Object.values(this.parts.attachments)) {
      for (const c of group.children) if (c.name === 'spin') c.rotation.y += ORBIT_SPIN * dt;
    }
  }

  private flash(opacity: number): void {
    this.parts.figure.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshLambertMaterial)) return;
      if (o.parent?.name.startsWith('attach_')) return;
      o.material.emissive.copy(FLASH_RED).multiplyScalar(opacity);
    });
  }

  angle(part: Pivot): number {
    return this.state.angles[part];
  }
}
