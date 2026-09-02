import type { Vec3 } from '../math/vec3';
import type { AttackKind } from '../hitReaction/hitTables';

// プレイヤーの状態更新で発生した出来事。application が VFX / SE / 振動 / ヒット判定に変換する。
export type PlayerEvent =
  | { readonly type: 'jumped' }
  | { readonly type: 'landed'; readonly fallSpeed: number }
  | { readonly type: 'dashStarted'; readonly direction: Vec3 }
  | { readonly type: 'sprintStarted' }
  | { readonly type: 'sprintEnded' }
  | { readonly type: 'attackStarted'; readonly kind: AttackKind; readonly stage: 1 | 2 | 3 }
  | {
      readonly type: 'attackActive';
      readonly kind: AttackKind;
      readonly attackId: number;
      readonly center: Vec3;
      readonly radius: number;
      readonly damage: number;
    }
  | { readonly type: 'attackEnded'; readonly kind: AttackKind }
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
