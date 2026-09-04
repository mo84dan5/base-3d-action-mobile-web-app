import type { Vec3 } from '../domain/math/vec3';
import type { AttackKind } from '../domain/hitReaction/hitTables';

// 発火点(F10 その他の発火点 / ヒット時の処理フロー)。位置・向き・パラメータのみを渡し、見た目は知らない。
export type EffectEvent =
  | {
      readonly kind: 'attackSwing';
      readonly attack: AttackKind;
      readonly position: Vec3;
      readonly yaw: number;
    }
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
