import type { Vec3 } from '../math/vec3';
import type { StaminaState } from '../stamina/stamina';

// プレイヤーの状態(F01 移動状態機械 + F04 戦闘状態 + F08 崖登り・滑空)。
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
  /** 通常攻撃の段(1〜3)。空中攻撃・スキル・バーストでは 1 */
  readonly stage: 1 | 2 | 3;
  /** 状態に入ってからの経過秒(エンティティ時間) */
  readonly elapsed: number;
  /** 当たり判定を既に発生させたか(持続中に 1 回だけヒットさせる用の攻撃 ID) */
  readonly attackId: number;
  /** 持続中に既にヒットさせた対象(敵 ID) */
  readonly hitTargets: readonly number[];
  /** 攻撃中に押された次の攻撃入力を 1 つだけ保持 */
  readonly bufferedAttack: boolean;
}

/** 接近強攻撃(格闘、長押し)の踏み込み(F04) */
export interface StrongAttackData {
  readonly phase: 'lunge' | 'swing';
  readonly lungeDir: Vec3;
  readonly lungeTime: number;
  readonly lungeTravelled: number;
  /** 踏み込みの距離上限(目標の手前 1.0 m、最大 3.15 m) */
  readonly lungeLimit: number;
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
  /** この空中滞在で空中攻撃を使ったか */
  readonly airAttackUsed: boolean;
  /** 直前の通常攻撃の段(次段判定用)。0 は未攻撃 */
  readonly lastAttackStage: 0 | 1 | 2 | 3;
  /** 次段の受付猶予の残り秒(全体時間の終了から 0.8 秒) */
  readonly comboWindowRemaining: number;
  readonly attack: AttackData | null;
  readonly strong: StrongAttackData | null;
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
  /** 攻撃 ID の採番用カウンタ */
  readonly attackCounter: number;
  /** ヒットストップ終了後に適用する被弾反応(F10 処理フロー 7〜9) */
  readonly pendingHit: PendingPlayerHit | null;
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
