import type { EquipmentSlot } from '../equipment/equipment';
import type { ClimbPhase, PlayerStateName } from '../player/playerState';
import { isGroundLocomotion } from '../player/playerState';

// ボタンの有効条件とラベル(F03 ボタン一覧)。技ボタンは 攻撃 = 右腕 / 左腕 / 頭 の 3 つ(F12)。

export interface ActionGateContext {
  readonly playerState: PlayerStateName;
  readonly climbPhase: ClimbPhase | null;
  readonly countdownActive: boolean;
  /** 実行中の技のスロット。別スロットの技ボタンは無効(F12) */
  readonly activeTechniqueSlot: EquipmentSlot | null;
  /** 移動連動(F11 N7)のスタイルを装備したスロット。Dash / Sprint / Climb / Glide 中も有効(F03) */
  readonly movementSlots: readonly EquipmentSlot[];
  /** スタミナ 0(スタミナ技のボタンは無効。F12) */
  readonly staminaEmpty: boolean;
  /** 押下の技がスタミナを使うスロット */
  readonly staminaSlots: readonly EquipmentSlot[];
  readonly burstCooldownReady: boolean;
  readonly energyFull: boolean;
  readonly hasInteractTarget: boolean;
}

export interface ButtonState {
  readonly enabled: boolean;
  readonly label: string;
}

export interface ButtonStates {
  readonly attack: ButtonState;
  readonly leftArm: ButtonState;
  readonly head: ButtonState;
  readonly burst: ButtonState;
  readonly jump: ButtonState;
  readonly sprint: ButtonState;
  readonly interact: ButtonState;
}

const AIRBORNE: readonly PlayerStateName[] = ['jump', 'fall'];

/** 通常攻撃: 接地移動中(地上攻撃)/ Jump・Fall(空中攻撃)。カウントダウン中は無効。 */
export function attackEnabled(ctx: ActionGateContext): boolean {
  if (ctx.countdownActive) return false;
  return (
    isGroundLocomotion(ctx.playerState) ||
    AIRBORNE.includes(ctx.playerState) ||
    ctx.playerState === 'shoot' ||
    ctx.playerState === 'charge' ||
    ctx.playerState === 'throw'
  );
}

/** 技ボタン(F12): 攻撃ボタンと同じ条件。別スロットの技の実行中は無効。 */
export function techniqueEnabled(ctx: ActionGateContext, slot: EquipmentSlot): boolean {
  if (ctx.activeTechniqueSlot !== null && ctx.activeTechniqueSlot !== slot) return false;
  if (ctx.staminaEmpty && ctx.staminaSlots.includes(slot)) return false;
  if (attackEnabled(ctx)) return true;
  return (
    !ctx.countdownActive &&
    ctx.movementSlots.includes(slot) &&
    MOVEMENT_STATES.includes(ctx.playerState)
  );
}

/** 移動連動のスタイルが技を出せる「技以外の状態」(F03 の例外) */
const MOVEMENT_STATES: readonly PlayerStateName[] = ['dash', 'sprint', 'climb', 'glide', 'slide'];

/** バースト: エネルギー 100%、接地移動中、クールダウン中でない。 */
export function burstEnabled(ctx: ActionGateContext): boolean {
  if (ctx.countdownActive) return false;
  return ctx.energyFull && ctx.burstCooldownReady && isGroundLocomotion(ctx.playerState);
}

/** ジャンプ: 常時有効(状態に応じた解釈はゲームロジック側)。 */
export function jumpEnabled(): boolean {
  return true;
}

/** スプリント: 常時有効(空中でも表示は有効のまま。崖登り中は「離す」)。 */
export function sprintEnabled(): boolean {
  return true;
}

/** インタラクト: 対象が範囲内にあり、接地移動中(攻撃系の行動中でない)。 */
export function interactEnabled(ctx: ActionGateContext): boolean {
  if (ctx.countdownActive) return false;
  return ctx.hasInteractTarget && isGroundLocomotion(ctx.playerState);
}

export function sprintButtonLabel(state: PlayerStateName): string {
  return state === 'climb' ? '離す' : 'スプリント';
}

export function jumpButtonLabel(state: PlayerStateName): string {
  switch (state) {
    case 'climb':
      return '崖ジャンプ';
    case 'glide':
      return '滑空解除';
    case 'fall':
      return '滑空';
    default:
      return 'ジャンプ';
  }
}

export function computeButtonStates(ctx: ActionGateContext): ButtonStates {
  return {
    attack: { enabled: techniqueEnabled(ctx, 'rightArm'), label: '攻撃' },
    leftArm: { enabled: techniqueEnabled(ctx, 'leftArm'), label: '左腕' },
    head: { enabled: techniqueEnabled(ctx, 'head'), label: '頭' },
    burst: { enabled: burstEnabled(ctx), label: 'バースト' },
    jump: { enabled: jumpEnabled(), label: jumpButtonLabel(ctx.playerState) },
    sprint: { enabled: sprintEnabled(), label: sprintButtonLabel(ctx.playerState) },
    interact: { enabled: interactEnabled(ctx), label: 'インタラクト' },
  };
}
