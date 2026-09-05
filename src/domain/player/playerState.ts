import type { ActionSpec, BuffKind } from '../attackStyle/actionSpec';
import type { AttackKind } from '../hitReaction/hitTables';
import type { Vec3 } from '../math/vec3';
import type { StaminaState } from '../stamina/stamina';

// プレイヤーの状態(F01 移動状態機械 + F04 戦闘状態 + F08 崖登り・滑空 + F11 スタイル行動)。
// 1 つの状態名と、状態固有のデータを持つ不変オブジェクト。

export type PlayerStateName =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'dash'
  | 'jump'
  | 'fall'
  | 'slide'
  | 'climb'
  | 'glide'
  | 'attack'
  | 'airAttack'
  | 'skill'
  | 'burst'
  | 'strongAttack'
  | 'shoot'
  | 'charge'
  | 'chargedShot'
  // F11 の汎用行動
  | 'area'
  | 'multihit'
  | 'throw'
  | 'cast'
  | 'guard'
  | 'maneuver'
  | 'pull'
  | 'hit'
  | 'dead';

export type ClimbPhase = 'attach' | 'climbing' | 'cliffJump' | 'mantle';

export interface ClimbData {
  readonly phase: ClimbPhase;
  /** 現在の面の法線(壁から外向き) */
  readonly wallNormal: Vec3;
  /** フェーズ内の経過秒(取り付き 0.2 秒、崖ジャンプ 0.3 秒、よじ登り 0.4 秒) */
  readonly phaseTime: number;
  /** よじ登りの開始位置と到達位置 */
  readonly mantleFrom?: Vec3;
  readonly mantleTo?: Vec3;
}

export interface AttackData {
  /** コンボの段(1 始まり)。空中攻撃・スキル・バーストでは 1 */
  readonly stage: number;
  /** 状態に入ってからの経過秒(エンティティ時間) */
  readonly elapsed: number;
  /** 当たり判定を既に発生させたか(持続中に 1 回だけヒットさせる用の攻撃 ID) */
  readonly attackId: number;
  /** 持続中に既にヒットさせた対象(敵 ID) */
  readonly hitTargets: readonly number[];
  /** 攻撃中に押された次の攻撃入力を 1 つだけ保持 */
  readonly bufferedAttack: boolean;
}

/** 踏み込み・突進(接近強攻撃など。F04 / F11 A2) */
export interface StrongAttackData {
  readonly phase: 'lunge' | 'swing';
  readonly lungeDir: Vec3;
  readonly lungeTime: number;
  readonly lungeTravelled: number;
  /** 踏み込みの距離上限(目標の手前 stopDistance m、最大 speed × maxTime) */
  readonly lungeLimit: number;
}

/** 実行中のスタイル行動(F11)。エンジンごとに使うフィールドが異なる。 */
export interface ActionRuntime {
  readonly spec: ActionSpec;
  readonly kind: AttackKind;
  readonly source: 'press' | 'hold';
  readonly styleId: string;
  /** 完了後に続けて始める行動(移動連動の then、ガードの release など) */
  readonly then: ActionSpec | null;
  readonly chargeRatio: number;
  /** タメによる半径・射程の倍率 */
  readonly radiusScale: number;
  readonly elapsed: number;
  /** エンジン固有のフェーズ名 */
  readonly phase: string;
  /** 発射・ヒットした回数(多段ヒット・連射・発射体の個数) */
  readonly hits: number;
  /** 次の発射・ヒット時刻(elapsed 基準) */
  readonly nextAt: number;
  /** 移動方向(回避・滑走・突進) */
  readonly dir: Vec3;
  readonly travelled: number;
  /** 引き寄せの対象 */
  readonly targetId: number | null;
  readonly fired: boolean;
  /** ガードの成否 */
  readonly succeeded: boolean;
  /** ダメージ倍率(タメ・リズム) */
  readonly damageScale: number;
}

export interface ActiveBuff {
  readonly effect: BuffKind;
  readonly amount: number;
  readonly duration: number;
  readonly remaining: number;
  readonly stacks: number;
  readonly maxStacks: number;
  /** リズム: 拍の周期と経過 */
  readonly beatSeconds: number;
  readonly beatTime: number;
}

export interface AmmoState {
  readonly remaining: number;
  readonly capacity: number;
  readonly reloadRemaining: number;
}

export interface PlayerState {
  readonly name: PlayerStateName;
  /** 足元位置 */
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** 向き(ラジアン。+z が 0) */
  readonly yaw: number;
  readonly hp: number;
  readonly stamina: StaminaState;
  /** 現在の状態に入ってからの経過秒(エンティティ時間) */
  readonly stateTime: number;
  /** 接地面の法線(接地中のみ意味を持つ) */
  readonly groundNormal: Vec3;
  readonly grounded: boolean;
  /** コヨーテタイム残り秒 */
  readonly coyoteRemaining: number;
  /** 着地ジャンプの入力バッファ残り秒 */
  readonly jumpBufferRemaining: number;
  /** この空中滞在で空中攻撃を使ったか(格闘の 1 回制限) */
  readonly airAttackUsed: boolean;
  /** この空中滞在で使った空中攻撃の回数(F11 airUses) */
  readonly airAttackCount: number;
  /** 直前の通常攻撃の段(次段判定用)。0 は未攻撃 */
  readonly lastAttackStage: number;
  /** 次段の受付猶予の残り秒(全体時間の終了から 0.8 秒) */
  readonly comboWindowRemaining: number;
  readonly attack: AttackData | null;
  readonly strong: StrongAttackData | null;
  /** 実行中のスタイル行動(F11)。attack / strong と併用する */
  readonly action: ActionRuntime | null;
  /** ヒットストップ中に届いた攻撃ボタンの長押し開始 / 終了を次の非停止ステップまで保持する(F10 入力の受付) */
  readonly bufferedAttackHold: { readonly start: boolean; readonly end: boolean };
  /** タメ時間(秒。Charge 中)/ タメ率(ChargedShot 中は発射時の値) */
  readonly chargeTime: number;
  readonly chargeRatio: number;
  readonly climb: ClimbData | null;
  /** 滑空の経過秒(鉛直速度の補間用) */
  readonly glideTime: number;
  /** 滑空開始時の鉛直速度 */
  readonly glideStartVy: number;
  /** 被弾硬直の残り秒 */
  readonly stunRemaining: number;
  /** 無敵の残り秒 */
  readonly invincibleRemaining: number;
  /** ノックバック速度と残り秒 */
  readonly knockback: Vec3;
  readonly knockbackRemaining: number;
  /** ヒットストップ残りステップ(ワールド時間で減る) */
  readonly hitstopSteps: number;
  /** スプリントボタンの長押し中か */
  readonly sprintHeld: boolean;
  /** ダッシュの方向(ダッシュ中のみ) */
  readonly dashDirection: Vec3;
  /** 直近のダッシュ終了からの秒(ダッシュ派生の猶予に使う) */
  readonly sinceDash: number;
  /** 攻撃 ID の採番用カウンタ */
  readonly attackCounter: number;
  /** ヒットストップ終了後に適用する被弾反応(F10 処理フロー 7〜9) */
  readonly pendingHit: PendingPlayerHit | null;
  /** 一時的な能力変化(F11 N10) */
  readonly buffs: readonly ActiveBuff[];
  /** 装弾(リボルバー)。null は装弾の概念なし */
  readonly ammo: AmmoState | null;
}

export interface PendingPlayerHit {
  readonly stunSeconds: number;
  readonly invincibleSeconds: number;
  readonly knockback: Vec3 | null;
  readonly knockbackDecay: number;
  readonly transition: 'none' | 'toFall' | 'hitState';
  /** Climb → Fall のとき面の法線方向に与える初速 */
  readonly detachVelocity: Vec3 | null;
}

/** 被弾処理の区分(F04「状態別の被弾処理」)。 */
export type HitCategory =
  'grounded' | 'burst' | 'airborne' | 'climb' | 'glide' | 'invulnerableAnim' | 'dead';

export function hitCategoryOf(
  name: PlayerStateName,
  climbPhase: ClimbPhase | null,
  grounded = true,
): HitCategory {
  switch (name) {
    case 'shoot':
    case 'throw':
    case 'maneuver':
    case 'area':
      return grounded ? 'grounded' : 'airborne';
    case 'burst':
      return 'burst';
    case 'jump':
    case 'fall':
    case 'airAttack':
      return 'airborne';
    case 'climb':
      return climbPhase === 'attach' || climbPhase === 'mantle' ? 'invulnerableAnim' : 'climb';
    case 'glide':
      return 'glide';
    case 'dead':
      return 'dead';
    default:
      return 'grounded';
  }
}

export const GROUND_LOCOMOTION: readonly PlayerStateName[] = ['idle', 'walk', 'run', 'sprint'];

export function isGroundLocomotion(name: PlayerStateName): boolean {
  return GROUND_LOCOMOTION.includes(name);
}

/** スタイル行動(攻撃ボタン由来)の状態か。 */
export const STYLE_ACTION_STATES: readonly PlayerStateName[] = [
  'attack',
  'airAttack',
  'strongAttack',
  'shoot',
  'charge',
  'chargedShot',
  'area',
  'multihit',
  'throw',
  'cast',
  'guard',
  'maneuver',
  'pull',
];

/** 攻撃力の倍率(F11 N10: コンボ成長・挑発)。 */
export function damageMultiplier(p: PlayerState): number {
  let mul = 1;
  for (const b of p.buffs) {
    if (b.effect === 'momentum') mul *= 1 + b.amount * b.stacks;
    if (b.effect === 'taunt' || b.effect === 'damageUp') mul *= 1 + b.amount;
  }
  return mul;
}

/** 被ダメージの倍率(F11 N10: 鉄壁)。 */
export function damageTakenMultiplier(p: PlayerState): number {
  let mul = 1;
  for (const b of p.buffs) if (b.effect === 'damageReduction') mul *= 1 - b.amount;
  return mul;
}

export function findBuff(p: PlayerState, effect: BuffKind): ActiveBuff | null {
  return p.buffs.find((b) => b.effect === effect) ?? null;
}
