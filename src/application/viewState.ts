import type { ButtonStates } from '../domain/action/actionGate';
import type { GameResult, Stats } from '../domain/combat/result';
import type { DeathProgress, EnemyKind } from '../domain/enemy/enemyState';
import type { DamageNumber, DamageNumberVisual } from '../domain/hitReaction/damageNumbers';
import type { Vec3 } from '../domain/math/vec3';
import type { ClimbPhase, PlayerStateName } from '../domain/player/playerState';
import type { PlacedObjectKind, StyleCategory, SummonKind } from '../domain/attackStyle/actionSpec';
import type { SummonPhase } from '../domain/summon/summon';

// レンダラ(infrastructure)と HUD(ui)が購読する、1 フレームぶんの表示状態。

export type SessionPhase = 'countdown' | 'playing' | 'ending' | 'ended';

export interface PlayerView {
  readonly position: Vec3;
  readonly yaw: number;
  readonly state: PlayerStateName;
  /** 回転攻撃の表示用回転速度(rad/s)。0 は回さない。表示の yaw に加算する */
  readonly spinRate: number;
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
  /** タメ率 0〜1(Charge 中のみ。それ以外は 0) */
  readonly chargeRatio: number;
  /** 現在の攻撃スタイル(F11) */
  readonly styleId: string;
  readonly styleCategory: StyleCategory;
  /** ガード中(受けの窓の中) */
  readonly guarding: boolean;
  /** タメ中のカメラ距離(スナイパー)。null は既定 */
  readonly chargeCameraDistance: number | null;
}

export interface ProjectileView {
  readonly id: number;
  readonly position: Vec3;
  readonly yaw: number;
  readonly radius: number;
  readonly styleId: string;
  readonly returning: boolean;
  /** 速度(向きと軌跡の表示用) */
  readonly velocity: Vec3;
}

export interface PlacedView {
  readonly id: number;
  readonly object: PlacedObjectKind;
  readonly position: Vec3;
  readonly yaw: number;
  readonly radius: number;
  /** 起動までの進行(遅延あり)または寿命の進行 0〜1 */
  readonly progress: number;
  readonly styleId: string;
}

export interface SummonView {
  readonly id: number;
  readonly entity: SummonKind;
  readonly position: Vec3;
  readonly phase: SummonPhase;
  readonly styleId: string;
}

export interface StyleHudView {
  readonly id: string;
  readonly name: string;
  readonly category: StyleCategory;
  /** 設定の ID が未実装 / 未知で格闘へフォールバックしたときの設定 ID */
  readonly fallbackFrom: string | null;
  /** ランダムで直前に選ばれたスタイル名 */
  readonly rolledName: string | null;
  /** 残弾 / 装弾数(リボルバー)。null は非表示 */
  readonly ammo: {
    readonly remaining: number;
    readonly capacity: number;
    readonly reloading: boolean;
  } | null;
  /** コンボ成長のヒット数。null は非表示 */
  readonly hitCount: number | null;
  /** リズムの拍の位相 0〜1。null は非表示 */
  readonly beat: number | null;
  readonly guarding: boolean;
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
  /** エネルギーの現在値 / 最大値(S02 要素 18 の数値表示) */
  readonly energy: number;
  readonly energyMax: number;
  /** エネルギー不足で行動が拒否された直後 0.4 秒間 true(EN バーの点滅) */
  readonly energyShort: boolean;
  /** 銃撃のタメ率(攻撃ボタンのリング表示用) */
  readonly chargeRatio: number;
  readonly indicator: 'climb' | 'glide' | null;
  readonly interactTargetName: string | null;
  readonly interactTargetPosition: Vec3 | null;
  readonly interactMessage: string | null;
  readonly result: GameResult | null;
  readonly stats: Stats;
  /** 直近の被ダメージ(HP バー横の数値表示用)。null は表示なし */
  readonly recentPlayerDamage: DamageNumberView | null;
  readonly style: StyleHudView;
}

export interface ViewState {
  readonly player: PlayerView;
  readonly enemies: readonly EnemyView[];
  readonly camera: CameraView;
  readonly damageNumbers: readonly DamageNumberView[];
  readonly projectiles: readonly ProjectileView[];
  readonly placed: readonly PlacedView[];
  readonly summons: readonly SummonView[];
  readonly hud: HudView;
  readonly worldTime: number;
}
