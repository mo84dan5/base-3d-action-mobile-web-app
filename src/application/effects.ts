import type { Vec3 } from '../domain/math/vec3';
import type { AttackKind } from '../domain/hitReaction/hitTables';
import type {
  ActionKind,
  BuffKind,
  MovementKind,
  PlacedObjectKind,
  SummonKind,
} from '../domain/attackStyle/actionSpec';
import type { HitVolume } from '../domain/combat/hitVolume';

// 発火点(F10 その他の発火点 / ヒット時の処理フロー)。位置・向き・パラメータのみを渡し、見た目は知らない。
export type EffectEvent =
  | {
      readonly kind: 'attackSwing';
      readonly attack: AttackKind;
      readonly position: Vec3;
      readonly yaw: number;
      /** スタイル行動の種別と ID(系統別の表現。スキル・バーストは null) */
      readonly action: ActionKind | null;
      readonly styleId: string | null;
    }
  | {
      readonly kind: 'attackVolume';
      readonly attack: AttackKind;
      readonly volume: HitVolume;
      readonly styleId: string | null;
    }
  | {
      readonly kind: 'projectileLaunch';
      readonly position: Vec3;
      readonly yaw: number;
      readonly styleId: string;
    }
  | {
      readonly kind: 'explosion';
      readonly position: Vec3;
      readonly radius: number;
      readonly styleId: string;
    }
  | {
      readonly kind: 'fieldPulse';
      readonly position: Vec3;
      readonly radius: number;
      readonly styleId: string;
    }
  | {
      readonly kind: 'placed';
      readonly object: PlacedObjectKind;
      readonly position: Vec3;
      readonly radius: number;
      readonly styleId: string;
    }
  | {
      readonly kind: 'placedExpire';
      readonly object: PlacedObjectKind;
      readonly position: Vec3;
      readonly styleId: string;
    }
  | {
      readonly kind: 'summon';
      readonly entity: SummonKind;
      readonly position: Vec3;
      readonly styleId: string;
    }
  | {
      readonly kind: 'summonStrike';
      readonly entity: SummonKind;
      readonly position: Vec3;
      readonly radius: number;
      readonly styleId: string;
    }
  | {
      readonly kind: 'summonExpire';
      readonly entity: SummonKind;
      readonly position: Vec3;
      readonly styleId: string;
    }
  | {
      readonly kind: 'guard';
      readonly phase: 'start' | 'success' | 'end';
      readonly position: Vec3;
      readonly yaw: number;
    }
  | {
      readonly kind: 'buff';
      readonly effect: BuffKind;
      readonly position: Vec3;
      readonly radius: number;
      readonly duration: number;
    }
  | {
      readonly kind: 'maneuver';
      readonly move: MovementKind;
      readonly position: Vec3;
      readonly direction: Vec3;
    }
  | { readonly kind: 'blink'; readonly from: Vec3; readonly to: Vec3 }
  | { readonly kind: 'pull'; readonly from: Vec3; readonly to: Vec3; readonly hold: boolean }
  | { readonly kind: 'selfDamage'; readonly position: Vec3 }
  | {
      readonly kind: 'tracer';
      readonly from: Vec3;
      readonly to: Vec3;
      readonly charged: boolean;
      readonly chargeRatio: number;
    }
  | { readonly kind: 'muzzleFlash'; readonly position: Vec3; readonly yaw: number }
  | { readonly kind: 'lunge'; readonly position: Vec3; readonly yaw: number }
  | { readonly kind: 'skillTelegraph'; readonly position: Vec3 }
  | { readonly kind: 'skillBurst'; readonly position: Vec3 }
  | { readonly kind: 'burstActivate'; readonly position: Vec3 }
  | {
      readonly kind: 'hitSpark';
      readonly attack: AttackKind;
      readonly position: Vec3;
      readonly victim: 'player' | 'enemy';
    }
  | {
      readonly kind: 'enemyDefeat';
      readonly position: Vec3;
      readonly enemyId: number;
      readonly enemyKind: 'dummy' | 'patrol';
    }
  | { readonly kind: 'playerDefeat'; readonly position: Vec3 }
  | { readonly kind: 'dash'; readonly position: Vec3; readonly yaw: number }
  | { readonly kind: 'jump'; readonly position: Vec3 }
  | { readonly kind: 'land'; readonly position: Vec3; readonly heavy: boolean }
  | { readonly kind: 'sprintDust'; readonly position: Vec3 }
  | { readonly kind: 'climbAttach'; readonly position: Vec3; readonly wallNormal: Vec3 }
  | { readonly kind: 'mantle'; readonly position: Vec3 }
  | { readonly kind: 'staminaDepleted' }
  | { readonly kind: 'interact'; readonly position: Vec3 }
  | { readonly kind: 'buttonPress' }
  | { readonly kind: 'vibrate'; readonly ms: number }
  | { readonly kind: 'sound'; readonly name: string };
