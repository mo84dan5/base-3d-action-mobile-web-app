import * as THREE from 'three';
import type {
  PlacedView,
  ProjectileView,
  SummonView,
  ViewState,
} from '../../application/viewState';
import type {
  PlacedObjectKind,
  StyleCategory,
  SummonKind,
} from '../../domain/attackStyle/actionSpec';
import { findAttackStyle } from '../../domain/attackStyle/attackStyleCatalog';

// 攻撃スタイル(F11)が生む持続オブジェクトの表示: 発射体・設置物・召喚体・ガード板。
// デザインディレクション「攻撃スタイル系統別の言語」: 飛翔体は四面体・板、設置物は低ポリの多面体、
// 召喚体は小さなカプセル、ガードは前方の半透明の板。寿命の残りはリングで示す。

const CATEGORY_COLORS: Readonly<Record<StyleCategory, string>> = {
  sword: '#FFFFFF',
  strike: '#E6EEF5',
  polearm: '#8FE3FF',
  firearm: '#FFFFFF',
  ranged: '#FFD166',
  magic: '#FFD166',
  placement: '#8FE3FF',
  defense: '#FFFFFF',
  movement: '#E6EEF5',
  special: '#FF6B35',
};

const SUMMON_COLOR = '#8FE3FF';
const RING_COLOR = '#4FD1FF';

function categoryOf(styleId: string): StyleCategory {
  return findAttackStyle(styleId)?.category ?? 'special';
}

interface Visual {
  readonly root: THREE.Group;
  readonly ring: THREE.Mesh | null;
}

export class StyleVisuals {
  readonly group = new THREE.Group();
  private readonly projectiles = new Map<number, Visual>();
  private readonly placed = new Map<number, Visual>();
  private readonly summons = new Map<number, Visual>();
  private readonly guardPlate: THREE.Mesh;
  private readonly materials = new Map<string, THREE.Material>();
  private time = 0;

  constructor(private readonly playerHeight: number) {
    this.group.name = 'styleVisuals';
    this.guardPlate = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 1.6),
      new THREE.MeshBasicMaterial({
        color: '#FFFFFF',
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.guardPlate.name = 'vfx_guard_plate';
    this.guardPlate.visible = false;
    this.group.add(this.guardPlate);
  }

  private material(color: string, opacity = 1, flat = true): THREE.Material {
    const key = `${color}_${opacity}_${flat ? 'l' : 'b'}`;
    let m = this.materials.get(key);
    if (!m) {
      m = flat
        ? new THREE.MeshLambertMaterial({
            color,
            flatShading: true,
            transparent: opacity < 1,
            opacity,
          })
        : new THREE.MeshBasicMaterial({
            color,
            transparent: opacity < 1,
            opacity,
            depthWrite: opacity >= 1,
          });
      this.materials.set(key, m);
    }
    return m;
  }

  private lifeRing(radius: number): THREE.Mesh {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1.0, 24),
      this.material(RING_COLOR, 0.7, false),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    ring.scale.setScalar(radius);
    return ring;
  }

  sync(view: ViewState, dt: number): void {
    this.time += dt;
    this.syncProjectiles(view.projectiles);
    this.syncPlaced(view.placed);
    this.syncSummons(view.summons);
    this.syncGuard(view);
  }

  private prune(map: Map<number, Visual>, items: readonly { readonly id: number }[]): void {
    const alive = new Set(items.map((i) => i.id));
    for (const [id, v] of map) {
      if (alive.has(id)) continue;
      this.group.remove(v.root);
      map.delete(id);
    }
  }

  private syncProjectiles(items: readonly ProjectileView[]): void {
    this.prune(this.projectiles, items);
    for (const p of items) {
      let v = this.projectiles.get(p.id);
      if (!v) {
        const root = new THREE.Group();
        root.name = `vfx_projectile_${p.styleId}`;
        const color = CATEGORY_COLORS[categoryOf(p.styleId)];
        const size = Math.max(0.12, p.radius);
        const body =
          categoryOf(p.styleId) === 'sword'
            ? new THREE.Mesh(
                new THREE.PlaneGeometry(size * 4, size * 1.2),
                this.material(color, 0.9, false),
              )
            : new THREE.Mesh(new THREE.TetrahedronGeometry(size), this.material(color));
        if (categoryOf(p.styleId) === 'sword') body.rotation.x = -Math.PI / 2;
        root.add(body);
        v = { root, ring: null };
        this.projectiles.set(p.id, v);
        this.group.add(root);
      }
      v.root.position.set(p.position.x, p.position.y, p.position.z);
      v.root.rotation.set(0, p.yaw, this.time * 12);
    }
  }

  private placedBody(kind: PlacedObjectKind, radius: number, color: string): THREE.Object3D {
    switch (kind) {
      case 'mine':
        return new THREE.Mesh(new THREE.OctahedronGeometry(0.25), this.material(color));
      case 'turret': {
        const g = new THREE.Group();
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), this.material(color));
        base.position.y = 0.25;
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 6), this.material('#FFFFFF'));
        head.rotation.x = Math.PI / 2;
        head.position.set(0, 0.7, 0.3);
        g.add(base, head);
        return g;
      }
      case 'stake': {
        const m = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.2, 5), this.material(color));
        m.position.y = 0.6;
        return m;
      }
      case 'field': {
        const m = new THREE.Mesh(
          new THREE.CylinderGeometry(radius, radius, 0.6, 16, 1, true),
          this.material(color, 0.25, false),
        );
        m.position.y = 0.3;
        return m;
      }
      case 'wall': {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(radius * 2, 2.0, 0.3),
          this.material(color, 0.6, false),
        );
        m.position.y = 1.0;
        return m;
      }
      case 'decoy': {
        const m = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.35, 1.0, 2, 6),
          this.material('#E6EEF5', 0.8),
        );
        m.position.y = 0.85;
        return m;
      }
      case 'barrel': {
        const m = new THREE.Mesh(
          new THREE.CylinderGeometry(0.35, 0.35, 0.8, 8),
          this.material('#FF6B35'),
        );
        m.rotation.z = Math.PI / 2;
        m.position.y = 0.35;
        return m;
      }
      case 'meteor': {
        const m = new THREE.Mesh(
          new THREE.IcosahedronGeometry(Math.max(0.4, radius * 0.3), 0),
          this.material('#FF6B35'),
        );
        m.position.y = 6;
        return m;
      }
      case 'gravity': {
        const m = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.5, 1),
          this.material('#FFD166', 0.6, false),
        );
        m.position.y = 1.0;
        return m;
      }
    }
  }

  private syncPlaced(items: readonly PlacedView[]): void {
    this.prune(this.placed, items);
    for (const o of items) {
      let v = this.placed.get(o.id);
      if (!v) {
        const root = new THREE.Group();
        root.name = `vfx_placed_${o.object}`;
        const color = CATEGORY_COLORS[categoryOf(o.styleId)];
        root.add(this.placedBody(o.object, o.radius, color));
        const ring = this.lifeRing(Math.min(o.radius, 2.5));
        ring.name = 'vfx_life_ring';
        root.add(ring);
        v = { root, ring };
        this.placed.set(o.id, v);
        this.group.add(root);
      }
      v.root.position.set(o.position.x, o.position.y, o.position.z);
      v.root.rotation.set(0, o.yaw, 0);
      if (v.ring)
        v.ring.scale.setScalar(Math.max(0.05, Math.min(o.radius, 2.5) * (1 - o.progress)));
      const body = v.root.children[0];
      if (body && o.object === 'meteor') body.position.y = 6 * (1 - o.progress);
      if (body && o.object === 'gravity') body.rotation.y = this.time * 2;
      if (body && o.object === 'mine') body.rotation.y = this.time;
    }
  }

  private summonBody(entity: SummonKind): THREE.Object3D {
    switch (entity) {
      case 'familiar':
        return new THREE.Mesh(
          new THREE.CapsuleGeometry(0.18, 0.3, 2, 6),
          this.material(SUMMON_COLOR),
        );
      case 'drone':
        return new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.4), this.material(SUMMON_COLOR));
      case 'swords': {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.16), this.material('#FFFFFF'));
        return m;
      }
      case 'mirage': {
        const m = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.4, this.playerHeight - 0.8, 2, 8),
          this.material('#E6EEF5', 0.5),
        );
        m.position.y = this.playerHeight / 2;
        return m;
      }
      case 'turret':
        return new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), this.material(SUMMON_COLOR));
    }
  }

  private syncSummons(items: readonly SummonView[]): void {
    this.prune(this.summons, items);
    for (const s of items) {
      let v = this.summons.get(s.id);
      if (!v) {
        const root = new THREE.Group();
        root.name = `vfx_summon_${s.entity}`;
        root.add(this.summonBody(s.entity));
        v = { root, ring: null };
        this.summons.set(s.id, v);
        this.group.add(root);
      }
      v.root.position.set(s.position.x, s.position.y, s.position.z);
      if (s.entity === 'swords')
        v.root.rotation.set(s.phase === 'launched' ? Math.PI / 2 : 0.3, this.time, 0);
      else if (s.entity !== 'mirage') v.root.rotation.set(0, this.time * 1.5, 0);
    }
  }

  private syncGuard(view: ViewState): void {
    const p = view.player;
    this.guardPlate.visible = p.guarding;
    if (!p.guarding) return;
    const forward = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    this.guardPlate.position
      .set(p.position.x, p.position.y + this.playerHeight / 2, p.position.z)
      .addScaledVector(forward, 0.7);
    this.guardPlate.rotation.set(0, p.yaw, 0);
    // 受けは 3 Hz 未満の明滅で示す
    (this.guardPlate.material as THREE.MeshBasicMaterial).opacity =
      0.3 + 0.15 * Math.sin(this.time * Math.PI * 2 * 2);
  }

  count(): number {
    return this.projectiles.size + this.placed.size + this.summons.size;
  }
}
