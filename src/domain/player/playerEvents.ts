import type {
  ActionKind,
  BuffKind,
  GuardSpec,
  MovementKind,
  PlacedObjectKind,
  PlacedSpec,
  ProjectileSpec,
  SummonKind,
  SummonSpec,
} from '../attackStyle/actionSpec';
import type { HitProfile } from '../combat/damage';
import type { HitVolume } from '../combat/hitVolume';
import type { AttackKind } from '../hitReaction/hitTables';
import type { Vec3 } from '../math/vec3';

// プレイヤーの状態更新で発生した出来事。application が VFX / SE / 振動 / ヒット判定に変換する。
export type PlayerEvent =
  | { readonly type: 'jumped' }
  | { readonly type: 'landed'; readonly fallSpeed: number }
  | { readonly type: 'dashStarted'; readonly direction: Vec3 }
  | { readonly type: 'sprintStarted' }
  | { readonly type: 'sprintEnded' }
  | {
      readonly type: 'attackStarted';
      readonly kind: AttackKind;
      readonly stage: number;
      /** スタイル行動の種別(VFX の系統別表現に使う)。スキル・バーストは null */
      readonly action: ActionKind | null;
      readonly styleId: string | null;
    }
  | {
      readonly type: 'attackActive';
      readonly kind: AttackKind;
      readonly attackId: number;
      /** 代表点と外径(球のときは判定そのもの) */
      readonly center: Vec3;
      readonly radius: number;
      readonly damage: number;
      readonly volume: HitVolume;
      /** スタイル定義のヒット性質。スキル・バーストは null(表を使う) */
      readonly profile: HitProfile | null;
    }
  | { readonly type: 'attackEnded'; readonly kind: AttackKind }
  | { readonly type: 'lungeStarted'; readonly direction: Vec3 }
  | {
      readonly type: 'shotFired';
      readonly kind: AttackKind;
      readonly attackId: number;
      readonly origin: Vec3;
      readonly direction: Vec3;
      /** 散弾・複数ロックの各射線(direction を含む) */
      readonly directions: readonly Vec3[];
      readonly range: number;
      readonly damage: number;
      readonly pierce: boolean;
      readonly beamWidth: number;
      readonly chargeRatio: number;
      readonly charged: boolean;
      readonly profile: HitProfile | null;
    }
  | {
      readonly type: 'projectileSpawned';
      readonly attackId: number;
      readonly spec: ProjectileSpec;
      readonly kind: AttackKind;
      readonly origin: Vec3;
      readonly direction: Vec3;
      readonly damage: number;
      readonly range: number;
      readonly profile: HitProfile;
      readonly styleId: string;
    }
  | {
      readonly type: 'objectPlaced';
      readonly attackId: number;
      readonly spec: PlacedSpec;
      readonly kind: AttackKind;
      readonly position: Vec3;
      readonly yaw: number;
      readonly profile: HitProfile;
      readonly styleId: string;
    }
  | {
      readonly type: 'placedCommand';
      readonly command: 'detonateAll' | 'boost' | 'push';
      readonly object: PlacedObjectKind;
      readonly spec: PlacedSpec;
      readonly profile: HitProfile;
    }
  | {
      readonly type: 'summoned';
      readonly attackId: number;
      readonly spec: SummonSpec;
      readonly kind: AttackKind;
      readonly position: Vec3;
      readonly yaw: number;
      readonly profile: HitProfile;
      readonly styleId: string;
    }
  | {
      readonly type: 'summonCommand';
      readonly command: 'charge' | 'launchAll' | 'boost';
      readonly entity: SummonKind;
      readonly spec: SummonSpec;
      readonly profile: HitProfile;
    }
  | { readonly type: 'guardStarted'; readonly spec: GuardSpec }
  | {
      readonly type: 'guardEnded';
      readonly reason: 'release' | 'timeout' | 'success' | 'hit' | 'counter';
    }
  | {
      readonly type: 'buffStarted';
      readonly effect: BuffKind;
      readonly amount: number;
      readonly duration: number;
      readonly radius: number;
      readonly position: Vec3;
    }
  | {
      readonly type: 'pullTick';
      readonly targetId: number;
      readonly towards: Vec3;
      readonly speed: number;
      readonly stopDistance: number;
      readonly hold: boolean;
    }
  | {
      readonly type: 'pullReleased';
      readonly targetId: number;
      readonly damage: number;
      readonly kind: AttackKind;
      readonly profile: HitProfile;
      readonly throwDirection: Vec3 | null;
      readonly throwDistance: number;
      readonly attackId: number;
    }
  | { readonly type: 'hpChanged'; readonly delta: number }
  | { readonly type: 'energySpent'; readonly amount: number }
  | {
      readonly type: 'maneuverStarted';
      readonly move: MovementKind;
      readonly position: Vec3;
      readonly direction: Vec3;
    }
  | { readonly type: 'blinked'; readonly from: Vec3; readonly to: Vec3 }
  | { readonly type: 'styleRolled'; readonly styleId: string }
  | {
      readonly type: 'actionRejected';
      /** cost: スタミナ / HP 不足、energy: エネルギー不足(HUD の EN バーを点滅させる) */
      readonly reason: 'cost' | 'energy' | 'requirement' | 'ammo' | 'hp';
    }
  | { readonly type: 'reloadStarted'; readonly seconds: number }
  | { readonly type: 'chargeStarted' }
  | { readonly type: 'chargeCancelled' }
  | { readonly type: 'climbAttached'; readonly wallNormal: Vec3 }
  | { readonly type: 'cliffJumped' }
  | { readonly type: 'mantled' }
  | { readonly type: 'climbDetached'; readonly reason: 'release' | 'stamina' | 'lost' | 'hit' }
  | { readonly type: 'glideStarted' }
  | {
      readonly type: 'glideEnded';
      readonly reason: 'release' | 'stamina' | 'landed' | 'hit' | 'climb';
    }
  | { readonly type: 'slideStarted' }
  | { readonly type: 'staminaDepleted' }
  | { readonly type: 'stunned' }
  | { readonly type: 'died' };
