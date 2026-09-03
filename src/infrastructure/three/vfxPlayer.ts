import * as THREE from 'three';
import type { EffectEvent } from '../../application/effects';
import type { EffectPort } from '../../application/ports';
import type { ViewState } from '../../application/viewState';
import type { GameConfig } from '../../domain/config/gameConfig';
import type { AttackKind } from '../../domain/hitReaction/hitTables';
import { qualityPreset, type Quality, type QualityPreset } from '../../domain/settings/settings';

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

function fanGeometry(
  innerR: number,
  outerR: number,
  angleDeg: number,
  segments = 8,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const half = (angleDeg * Math.PI) / 360;
  for (let i = 0; i < segments; i++) {
    const a0 = -half + (i / segments) * half * 2;
    const a1 = -half + ((i + 1) / segments) * half * 2;
    const taper0 = 1 - Math.abs(a0) / half / 2;
    const taper1 = 1 - Math.abs(a1) / half / 2;
    const o0 = outerR * (0.6 + 0.4 * taper0);
    const o1 = outerR * (0.6 + 0.4 * taper1);
    positions.push(
      innerR * Math.cos(a0),
      innerR * Math.sin(a0),
      0,
      o0 * Math.cos(a0),
      o0 * Math.sin(a0),
      0,
      o1 * Math.cos(a1),
      o1 * Math.sin(a1),
      0,
      innerR * Math.cos(a0),
      innerR * Math.sin(a0),
      0,
      o1 * Math.cos(a1),
      o1 * Math.sin(a1),
      0,
      innerR * Math.cos(a1),
      innerR * Math.sin(a1),
      0,
    );
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

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeIn(t: number): number {
  return t * t;
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
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
        this.slash(event.attack, event.position, event.yaw);
        break;
      case 'hitSpark':
        this.spark(event.attack, event.position);
        break;
      case 'skillTelegraph':
        this.shrinkRing(
          event.position,
          'yellow',
          this.config.combat.skill.radius,
          this.config.combat.skill.startup,
        );
        break;
      case 'skillBurst':
        this.ring(event.position, 'yellow', this.config.combat.skill.radius);
        this.shardBurst(event.position, 8, 'yellow');
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

  private slash(
    kind: AttackKind,
    position: { x: number; y: number; z: number },
    yaw: number,
  ): void {
    const outer = kind === 'normal3' ? 1.6 : kind === 'enemyAttack' ? 1.0 : 1.4;
    const color: ColorName = kind === 'enemyAttack' ? 'red' : 'white';
    const roll =
      kind === 'normal1'
        ? Math.PI / 4
        : kind === 'normal2'
          ? -Math.PI / 4
          : kind === 'airAttack'
            ? Math.PI / 2
            : 0;
    const mesh = this.play(
      `vfx_${kind}_slash_${outer}`,
      () => new THREE.Mesh(fanGeometry(0.6, outer, 110), this.material(color)),
      0.15,
      (t, m) => {
        const appear = clamp01(t / (2 / 9));
        m.scale.setScalar(easeOut(appear));
        (m.material as THREE.MeshBasicMaterial).opacity =
          t < 0.33 ? 1 : 1 - easeIn((t - 0.33) / 0.67);
      },
    );
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    mesh.position
      .set(position.x, position.y + 0.85, position.z)
      .addScaledVector(forward, this.config.combat.hitSphereForward);
    mesh.rotation.set(0, yaw, roll);
    mesh.material = this.material(color).clone();
  }

  private spark(kind: AttackKind, position: { x: number; y: number; z: number }): void {
    const count = this.particleCount(kind === 'normal3' ? 6 : 4);
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
    if (kind === 'normal3') this.ring(position, 'cyan', 1.0);
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
