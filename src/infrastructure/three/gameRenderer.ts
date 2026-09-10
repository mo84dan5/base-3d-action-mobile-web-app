import * as THREE from 'three';
import type { ScreenPoint, ScreenProjector } from '../../application/ports';
import type { EnemyView, PlayerView, ViewState } from '../../application/viewState';
import type { GameConfig } from '../../domain/config/gameConfig';
import type { Vec3 } from '../../domain/math/vec3';
import {
  fovFor,
  viewOffsetFor,
  type Orientation,
  type ViewportSize,
} from '../../domain/orientation/orientation';
import { qualityPreset, type Quality } from '../../domain/settings/settings';
import type { StageLayout } from '../../domain/stage/stageLayout';
import { buildCharacterParts, CharacterAnimator } from './characterParts';
import { buildStageGeometry, type StageGeometry } from './stageGeometry';
import { StyleVisuals } from './styleVisuals';
import { VfxPlayer } from './vfxPlayer';

// Three.js による描画(F06 表示品質、F07、F09 手順 4、デザインディレクション)。
// UI は描かない(HTML/CSS の上に canvas を敷く)。物理状態は前後フレームで補間して描く(F05)。

const DUMMY_COLOR = '#b8a680';
const PATROL_COLOR = '#7a4b9e';
const FLASH_WHITE = new THREE.Color('#ffffff');

/** 脚を振らない状態(空中・滑空・崖登り) */
const AIRBORNE_STATES = new Set<PlayerView['state']>(['jump', 'fall', 'glide', 'climb']);
const FRAME_SECONDS = 1 / 60;

interface CharacterVisual {
  readonly root: THREE.Group;
  readonly body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  readonly baseColor: THREE.Color;
}

function lerpVec(a: Vec3, b: Vec3, t: number): THREE.Vector3 {
  return new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class GameRenderer implements ScreenProjector {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly vfx: VfxPlayer;
  readonly styleVisuals: StyleVisuals;
  private readonly light: THREE.DirectionalLight;
  private readonly stage: StageGeometry;
  private readonly player: CharacterAnimator;
  /** 回転攻撃の表示用に yaw へ加算する角度(F11。ロジックの yaw は変えない) */
  private spinAngle = 0;
  private readonly enemies = new Map<number, CharacterVisual>();
  private size: ViewportSize = { width: 1, height: 1 };
  private orientation: Orientation = 'landscape';
  private quality: Quality;
  private readonly playerGeometry: THREE.BufferGeometry;
  private readonly enemyGeometry: THREE.BufferGeometry;
  private readonly projected = new THREE.Vector3();

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly config: GameConfig,
    layout: StageLayout,
    quality: Quality,
  ) {
    this.quality = quality;
    // antialias は生成時のみ指定可能。実行時には切り替えない(F06)
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color('#9fb6c9');
    this.scene.fog = new THREE.Fog('#9fb6c9', 40, 90);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);

    const hemi = new THREE.HemisphereLight('#dfe9f3', '#5a6a4a', 0.9);
    this.scene.add(hemi);
    this.light = new THREE.DirectionalLight('#ffffff', 1.6);
    this.light.position.set(20, 40, 10);
    this.light.castShadow = true;
    this.light.shadow.camera.left = -40;
    this.light.shadow.camera.right = 40;
    this.light.shadow.camera.top = 40;
    this.light.shadow.camera.bottom = -40;
    this.light.shadow.camera.far = 120;
    this.light.shadow.bias = -0.0005;
    this.scene.add(this.light);

    this.stage = buildStageGeometry(layout);
    this.scene.add(this.stage.visual);
    this.scene.add(this.signboard(layout.signboard.position));

    const r = config.physics.playerCapsuleRadius;
    this.playerGeometry = new THREE.CapsuleGeometry(
      r,
      config.physics.playerCapsuleHeight - r * 2,
      2,
      8,
    );
    this.enemyGeometry = new THREE.CapsuleGeometry(
      config.enemy.capsuleRadius,
      config.enemy.capsuleHeight - config.enemy.capsuleRadius * 2,
      2,
      8,
    );
    this.player = new CharacterAnimator(buildCharacterParts());
    this.scene.add(this.player.parts.root);

    this.vfx = new VfxPlayer(config, quality, this.playerGeometry);
    this.scene.add(this.vfx.group);
    this.styleVisuals = new StyleVisuals(config.physics.playerCapsuleHeight);
    this.scene.add(this.styleVisuals.group);
    this.applyQuality(quality);
  }

  get collisionGeometry(): THREE.BufferGeometry {
    return this.stage.collision;
  }

  private character(
    geometry: THREE.BufferGeometry,
    color: string,
    height: number,
    withNose: boolean,
  ): CharacterVisual {
    const root = new THREE.Group();
    const material = new THREE.MeshLambertMaterial({ color, flatShading: true });
    const body = new THREE.Mesh(geometry, material);
    body.position.y = height / 2;
    body.castShadow = true;
    root.add(body);
    if (withNose) {
      const nose = new THREE.Mesh(
        new THREE.ConeGeometry(0.12, 0.3, 6),
        new THREE.MeshLambertMaterial({ color: '#e8f0ff', flatShading: true }),
      );
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, height * 0.75, 0.45);
      root.add(nose);
    } else {
      const eye = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.1, 0.1),
        new THREE.MeshBasicMaterial({ color: '#e5333f' }),
      );
      eye.position.set(0, height * 0.8, 0.5);
      root.add(eye);
    }
    return { root, body, baseColor: new THREE.Color(color) };
  }

  private signboard(position: Vec3): THREE.Group {
    const g = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 1.2, 0.1),
      new THREE.MeshLambertMaterial({ color: '#6b4f2a', flatShading: true }),
    );
    post.position.y = 0.6;
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.6, 0.08),
      new THREE.MeshLambertMaterial({ color: '#d9c48a', flatShading: true }),
    );
    board.position.y = 1.3;
    post.castShadow = true;
    board.castShadow = true;
    g.add(post, board);
    g.position.set(position.x, position.y, position.z);
    g.name = 'signboard';
    return g;
  }

  /** 表示品質の適用(F06)。解像度スケールと影を即時に切り替える。 */
  applyQuality(quality: Quality): void {
    this.quality = quality;
    const preset = qualityPreset(quality);
    const ratio =
      preset.pixelRatioScale === 'device'
        ? Math.min(window.devicePixelRatio, 2)
        : preset.pixelRatioScale;
    this.renderer.setPixelRatio(ratio);
    const shadows = preset.shadowMapSize > 0;
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      this.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const mesh = o as THREE.Mesh;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) m.needsUpdate = true;
        }
      });
    }
    if (shadows) {
      this.light.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      if (this.light.shadow.map) {
        this.light.shadow.map.dispose();
        this.light.shadow.map = null;
      }
    }
    this.vfx.setQuality(quality);
  }

  /** 表示領域の変更(F09 手順 4)。canvas の CSS サイズは書き換えない。 */
  resize(size: ViewportSize, orientation: Orientation): void {
    this.size = size;
    this.orientation = orientation;
    this.renderer.setSize(size.width, size.height, false);
    this.camera.aspect = size.width / size.height;
    this.camera.fov = fovFor(orientation, this.config.camera);
    const vo = viewOffsetFor(size.width, size.height, orientation, this.config.camera);
    this.camera.setViewOffset(vo.fullWidth, vo.fullHeight, vo.x, vo.y, vo.width, vo.height);
    this.camera.updateProjectionMatrix();
  }

  /** 前後フレームの表示状態を alpha で補間して描く。 */
  render(prev: ViewState, curr: ViewState, alpha: number): void {
    this.syncPlayer(prev, curr, alpha);
    this.syncEnemies(prev, curr, alpha);
    const camPos = lerpVec(prev.camera.position, curr.camera.position, alpha);
    const look = lerpVec(prev.camera.lookAt, curr.camera.lookAt, alpha);
    this.camera.position.copy(camPos);
    this.camera.lookAt(look);
    this.vfx.syncWithView(curr);
    this.styleVisuals.sync(curr, 1 / 60);
    const dim = this.vfx.sceneDim();
    const desat = curr.player.defeatProgress;
    this.canvas.style.filter =
      dim > 0 || desat > 0 ? `brightness(${1 - dim}) saturate(${1 - 0.5 * desat})` : '';
    this.renderer.render(this.scene, this.camera);
  }

  /** 更新ループ停止中の再配置用に 1 回だけ描く。 */
  renderOnce(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** デバッグ用: 名前で探したオブジェクトの NDC(x, y: -1〜1、z: 深度)。無ければ null。 */
  projectObject(name: string): [number, number, number] | null {
    const o = this.scene.getObjectByName(name);
    if (!o) return null;
    const v = new THREE.Vector3();
    o.updateWorldMatrix(true, false);
    v.setFromMatrixPosition(o.matrixWorld).project(this.camera);
    return [v.x, v.y, v.z];
  }

  /** デバッグ・E2E 用: パーツの回転角と付属物(F12) */
  playerPartsInfo(): {
    angles: Record<'head' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg', number>;
    attachments: Record<'head' | 'rightArm' | 'leftArm', number>;
  } {
    const a = this.player.parts.attachments;
    return {
      angles: {
        head: this.player.angle('head'),
        rightArm: this.player.angle('rightArm'),
        leftArm: this.player.angle('leftArm'),
        rightLeg: this.player.angle('rightLeg'),
        leftLeg: this.player.angle('leftLeg'),
      },
      attachments: {
        head: a.head.children.length,
        rightArm: a.rightArm.children.length,
        leftArm: a.leftArm.children.length,
      },
    };
  }

  drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  private syncPlayer(prev: ViewState, curr: ViewState, alpha: number): void {
    const p = curr.player;
    const pos = lerpVec(prev.player.position, p.position, alpha);
    const { root, figure } = this.player.parts;
    root.position.copy(pos);
    this.spinAngle = p.spinRate > 0 ? (this.spinAngle + p.spinRate / 60) % (Math.PI * 2) : 0;
    root.rotation.set(0, lerpAngle(prev.player.yaw, p.yaw, alpha) + this.spinAngle, 0);
    root.visible = p.visible;
    // 倒れ: 足元を支点に横へ倒す(6 パーツ全体)
    const tilt = (p.defeatProgress * Math.PI) / 2;
    figure.rotation.set(0, 0, tilt);
    const climbTilt = p.state === 'climb' ? 0.15 : p.state === 'glide' ? -0.35 : 0;
    root.rotation.x = climbTilt;
    const grounded = !AIRBORNE_STATES.has(p.state);
    this.player.update(
      {
        motion: p.partMotion,
        speed: Math.hypot(p.velocity.x, p.velocity.z),
        grounded,
        dashing: p.state === 'dash',
        equipment: {
          head: p.equipment.head.category,
          rightArm: p.equipment.rightArm.category,
          leftArm: p.equipment.leftArm.category,
        },
        locomotion: p.locomotion,
        flashOpacity: p.flashOpacity,
      },
      FRAME_SECONDS,
    );
  }

  private syncEnemies(prev: ViewState, curr: ViewState, alpha: number): void {
    const seen = new Set<number>();
    for (const e of curr.enemies) {
      seen.add(e.id);
      const visual = this.enemyVisual(e);
      const before = prev.enemies.find((x) => x.id === e.id) ?? e;
      visual.root.position.copy(lerpVec(before.position, e.position, alpha));
      visual.root.rotation.set(0, lerpAngle(before.yaw, e.yaw, alpha), 0);
      visual.root.visible = e.visible;
      visual.body.material.emissive.copy(FLASH_WHITE).multiplyScalar(e.flashIntensity);
      const collapse =
        e.death?.phase === 'collapse' ? e.death.collapseRatio : e.death?.phase === 'done' ? 1 : 0;
      const sy = Math.max(0.01, 1 - collapse * collapse);
      visual.body.scale.set(1 + collapse * 0.3, sy, 1 + collapse * 0.3);
      visual.body.position.y = (this.config.enemy.capsuleHeight / 2) * sy;
    }
    for (const [id, visual] of this.enemies) {
      if (!seen.has(id)) visual.root.visible = false;
    }
  }

  private enemyVisual(e: EnemyView): CharacterVisual {
    let visual = this.enemies.get(e.id);
    if (!visual) {
      visual = this.character(
        this.enemyGeometry,
        e.kind === 'dummy' ? DUMMY_COLOR : PATROL_COLOR,
        this.config.enemy.capsuleHeight,
        false,
      );
      visual.root.name = `enemy_${e.id}`;
      this.enemies.set(e.id, visual);
      this.scene.add(visual.root);
    }
    return visual;
  }

  /** 3D → 2D 投影(CSS px)。setViewOffset を含む射影行列を使う。 */
  project(world: Vec3): ScreenPoint {
    this.projected.set(world.x, world.y, world.z).project(this.camera);
    const inFront = this.projected.z < 1;
    return {
      x: ((this.projected.x + 1) / 2) * this.size.width,
      y: ((1 - this.projected.y) / 2) * this.size.height,
      inFront,
    };
  }

  currentOrientation(): Orientation {
    return this.orientation;
  }

  currentQuality(): Quality {
    return this.quality;
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
