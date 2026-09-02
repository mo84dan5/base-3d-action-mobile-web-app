import type { ButtonStates } from '../domain/action/actionGate';
import type { GameResult, Stats } from '../domain/combat/result';
import type { DeathProgress, EnemyKind } from '../domain/enemy/enemyState';
import type { DamageNumber, DamageNumberVisual } from '../domain/hitReaction/damageNumbers';
import type { Vec3 } from '../domain/math/vec3';
import type { ClimbPhase, PlayerStateName } from '../domain/player/playerState';

// レンダラ(infrastructure)と HUD(ui)が購読する、1 フレームぶんの表示状態。

export type SessionPhase = 'countdown' | 'playing' | 'ending' | 'ended';

export interface PlayerView {
  readonly position: Vec3;
  readonly yaw: number;
  readonly state: PlayerStateName;
  readonly climbPhase: ClimbPhase | null;
  readonly velocity: Vec3;
  /** ヒットフラッシュ(赤)の不透明度 0〜0.8 */
  readonly flashOpacity: number;
  readonly visible: boolean;
  readonly hp: number;
  readonly maxHp: number;
  readonly stamina: number;
  readonly staminaMax: number;
  readonly staminaLow: boolean;
  /** 倒れモーションの進行 0〜1(Dead のみ) */
  readonly defeatProgress: number;
}

export interface EnemyView {
  readonly id: number;
  readonly kind: EnemyKind;
  readonly position: Vec3;
  readonly yaw: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly flashIntensity: number;
  readonly hpBarVisible: boolean;
  readonly death: DeathProgress | null;
  readonly telegraphOpacity: number;
  readonly attacking: boolean;
  readonly visible: boolean;
}

export interface CameraView {
  readonly position: Vec3;
  readonly lookAt: Vec3;
  readonly yaw: number;
}

export interface DamageNumberView {
  readonly number: DamageNumber;
  readonly visual: DamageNumberVisual;
  /** 上昇を加えた表示位置(ワールド) */
  readonly worldPosition: Vec3;
}

export interface HudView {
  readonly phase: SessionPhase;
  readonly countdownLabel: string | null;
  readonly buttons: ButtonStates;
  readonly skillCooldownRatio: number;
  readonly skillCooldownLabel: string;
  readonly energyRatio: number;
  readonly energyFull: boolean;
  readonly indicator: 'climb' | 'glide' | null;
  readonly interactTargetName: string | null;
  readonly interactMessage: string | null;
  readonly result: GameResult | null;
  readonly stats: Stats;
  /** 直近の被ダメージ(HP バー横の数値表示用)。null は表示なし */
  readonly recentPlayerDamage: DamageNumberView | null;
}

export interface ViewState {
  readonly player: PlayerView;
  readonly enemies: readonly EnemyView[];
  readonly camera: CameraView;
  readonly damageNumbers: readonly DamageNumberView[];
  readonly hud: HudView;
  readonly worldTime: number;
}
