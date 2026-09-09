import type { EquipmentSlot } from '../domain/equipment/equipment';
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
  /** 実行中の技のスタイル(F11)。技の実行中でなければ右腕のスタイル */
  readonly styleId: string;
  readonly styleCategory: StyleCategory;
  /** 装備(F12): スロットごとのスタイルと系統(パーツの付属物の表示用) */
  readonly equipment: Readonly<
    Record<EquipmentSlot, { readonly styleId: string; readonly category: StyleCategory }>
  >;
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

/** 技ボタンに出すスロットごとの情報(S02 要素 6 / 7 / 19) */
export interface TechniqueHudView {
  readonly id: string;
  readonly name: string;
  /** 先頭 3 文字の略称 */
  readonly shortName: string;
  readonly category: StyleCategory;
  readonly fallbackFrom: string | null;
  readonly ammo: {
    readonly remaining: number;
    readonly capacity: number;
    readonly reloading: boolean;
  } | null;
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
  readonly energyRatio: number;
  readonly energyFull: boolean;
  /** エネルギーの現在値 / 最大値(S02 要素 18 の数値表示) */
  readonly energy: number;
  readonly energyMax: number;
  /** エネルギー不足で行動が拒否された直後 0.4 秒間 true(EN バーの点滅) */
  readonly energyShort: boolean;
  /** タメ率(実行中の技のボタンのリング表示用) */
  readonly chargeRatio: number;
  /** 実行中の技のスロット。null は技の実行中でない */
  readonly activeTechniqueSlot: EquipmentSlot | null;
  readonly indicator: 'climb' | 'glide' | null;
  readonly interactTargetName: string | null;
  readonly interactTargetPosition: Vec3 | null;
  readonly interactMessage: string | null;
  readonly result: GameResult | null;
  readonly stats: Stats;
  /** 直近の被ダメージ(HP バー横の数値表示用)。null は表示なし */
  readonly recentPlayerDamage: DamageNumberView | null;
  /** スロットごとの技の表示(F12)。`style` は互換のため右腕(または実行中の技)を指す */
  readonly techniques: Readonly<Record<EquipmentSlot, TechniqueHudView>>;
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
