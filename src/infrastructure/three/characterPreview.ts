import * as THREE from 'three';
import type { StyleCategory } from '../../domain/attackStyle/actionSpec';
import type { AssemblySlot, EquipmentSlot } from '../../domain/equipment/equipment';
import type { LocomotionType } from '../../domain/locomotion/locomotion';
import type { Vec3 } from '../../domain/math/vec3';
import type { PartMotion } from '../../domain/player/partMotion';
import { buildCharacterParts, CharacterAnimator, type PlayerPose } from './characterParts';

// S05 装備組み替えの小窓(キャラクター.md 組み替えプレビュー)。
// 本編の renderer とは別の小さな WebGL 描画で、本編と同じパーツ・付属物・モーションの実装で全身を描く。
// 表示中だけ描画ループを回し、閉じたら止める。

const BACKGROUND = '#1b232c';
const DEG = Math.PI / 180;

/** カメラ: 垂直 FOV 30 度、注視点 (0, 0.9, 0)、距離 3.4 m、右前 35 度、仰角 10 度 */
export const PREVIEW_CAMERA = {
  fov: 30,
  target: { x: 0, y: 0.9, z: 0 } as Vec3,
  distance: 3.4,
  azimuthDeg: 35,
  elevationDeg: 10,
} as const;

/** キャラクターの自転(rad/s)。20 秒弱で 1 周 */
export const PREVIEW_SPIN = 0.35;

/** デモモーションの長さ(秒): 技は押下 1 回、脚は歩き */
export const DEMO_SECONDS = { technique: 0.6, walk: 1.5 } as const;
/** 歩きのデモの速度(m/s)。歩き(≤ 1.8 m/s)の脚の振りになる */
const WALK_DEMO_SPEED = 1.0;

/** カメラ位置。右前 = プレイヤーの右(−X)側の正面(+Z)寄り */
export function previewCameraPosition(): Vec3 {
  const { target, distance, azimuthDeg, elevationDeg } = PREVIEW_CAMERA;
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  const horizontal = distance * Math.cos(el);
  return {
    x: target.x - horizontal * Math.sin(az),
    y: target.y + distance * Math.sin(el),
    z: target.z + horizontal * Math.cos(az),
  };
}

export interface PreviewEquipment {
  readonly categories: Readonly<Record<EquipmentSlot, StyleCategory>>;
  readonly locomotion: LocomotionType;
}

export interface Demo {
  readonly slot: AssemblySlot;
  /** 開始からの経過(秒) */
  readonly elapsed: number;
}

/** 経過に応じたデモの見え方。終わった(null)ら待機に戻す */
export function demoPose(demo: Demo | null): { motion: PartMotion | null; speed: number } {
  if (!demo) return { motion: null, speed: 0 };
  if (demo.slot === 'legs') {
    return { motion: null, speed: demo.elapsed < DEMO_SECONDS.walk ? WALK_DEMO_SPEED : 0 };
  }
  if (demo.elapsed >= DEMO_SECONDS.technique) return { motion: null, speed: 0 };
  return {
    motion: { part: demo.slot, progress: demo.elapsed / DEMO_SECONDS.technique, hold: false },
    speed: 0,
  };
}

export function advanceDemo(demo: Demo | null, dt: number): Demo | null {
  if (!demo) return null;
  const elapsed = demo.elapsed + dt;
  const limit = demo.slot === 'legs' ? DEMO_SECONDS.walk : DEMO_SECONDS.technique;
  return elapsed >= limit ? null : { slot: demo.slot, elapsed };
}

export class CharacterPreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly animator: CharacterAnimator;
  private equipment: PreviewEquipment;
  private demo: Demo | null = null;
  private frameId: number | null = null;
  private lastTime = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    initial: PreviewEquipment,
  ) {
    this.equipment = initial;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.shadowMap.enabled = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(BACKGROUND);
    this.camera = new THREE.PerspectiveCamera(PREVIEW_CAMERA.fov, 1, 0.1, 20);
    const pos = previewCameraPosition();
    this.camera.position.set(pos.x, pos.y, pos.z);
    const t = PREVIEW_CAMERA.target;
    this.camera.lookAt(t.x, t.y, t.z);

    this.scene.add(new THREE.HemisphereLight('#dfe9f3', '#5a6a4a', 0.9));
    const light = new THREE.DirectionalLight('#ffffff', 1.2);
    // カメラの右上後方(プレイヤーの右 = −X 側)から当てる
    light.position.set(pos.x * 1.3 - 1.0, pos.y + 2.0, pos.z * 1.3);
    this.scene.add(light);

    this.animator = new CharacterAnimator(buildCharacterParts());
    this.scene.add(this.animator.parts.root);
    this.animator.update(this.pose(0), 0);
    this.resize();
  }

  /** 装備を差し替える(付属物・脚パーツは次のフレームで反映) */
  setEquipment(equipment: PreviewEquipment): void {
    this.equipment = equipment;
    if (this.frameId === null) this.renderFrame(0);
  }

  /** 選んだスロットのデモモーションを最初から再生する */
  play(slot: AssemblySlot): void {
    this.demo = { slot, elapsed: 0 };
  }

  isRunning(): boolean {
    return this.frameId !== null;
  }

  start(): void {
    if (this.frameId !== null) return;
    this.lastTime = 0;
    this.resize();
    const loop = (time: number) => {
      this.frameId = requestAnimationFrame(loop);
      const dt = this.lastTime === 0 ? 0 : Math.min(0.05, (time - this.lastTime) / 1000);
      this.lastTime = time;
      this.renderFrame(dt);
    };
    this.frameId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.frameId === null) return;
    cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  /** canvas の CSS 寸法に合わせる(向きが変わったときに呼ぶ) */
  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** デバッグ・E2E 用: 付属物の数と脚の移動タイプ */
  info(): {
    running: boolean;
    attachments: Record<EquipmentSlot, number>;
    locomotion: LocomotionType;
    demo: AssemblySlot | null;
  } {
    const a = this.animator.parts.attachments;
    return {
      running: this.isRunning(),
      attachments: {
        head: a.head.children.length,
        rightArm: a.rightArm.children.length,
        leftArm: a.leftArm.children.length,
      },
      locomotion: this.animator.parts.legs.locomotion,
      demo: this.demo?.slot ?? null,
    };
  }

  dispose(): void {
    this.stop();
    this.renderer.dispose();
  }

  private pose(dt: number): PlayerPose {
    const { motion, speed } = demoPose(this.demo);
    this.demo = advanceDemo(this.demo, dt);
    return {
      motion,
      speed,
      grounded: true,
      dashing: false,
      equipment: this.equipment.categories,
      locomotion: this.equipment.locomotion,
      flashOpacity: 0,
    };
  }

  private renderFrame(dt: number): void {
    this.animator.parts.root.rotation.y += PREVIEW_SPIN * dt;
    this.animator.update(this.pose(dt), dt);
    this.renderer.render(this.scene, this.camera);
  }
}
