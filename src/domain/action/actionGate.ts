import type { ClimbPhase, PlayerStateName } from '../player/playerState';
import { isGroundLocomotion } from '../player/playerState';

// ボタンの有効条件とラベル(F03 ボタン一覧)。

export interface ActionGateContext {
  readonly playerState: PlayerStateName;
  readonly climbPhase: ClimbPhase | null;
  readonly countdownActive: boolean;
  readonly skillCooldownReady: boolean;
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
  readonly skill: ButtonState;
  readonly burst: ButtonState;
  readonly jump: ButtonState;
  readonly sprint: ButtonState;
  readonly interact: ButtonState;
}

const AIRBORNE: readonly PlayerStateName[] = ['jump', 'fall'];

/** 通常攻撃: 接地移動中(地上攻撃)/ Jump・Fall(空中攻撃)。カウントダウン中は無効。 */
export function attackEnabled(ctx: ActionGateContext): boolean {
  if (ctx.countdownActive) return false;
  return isGroundLocomotion(ctx.playerState) || AIRBORNE.includes(ctx.playerState);
}

/** スキル: クールダウン中でなく接地移動中。 */
export function skillEnabled(ctx: ActionGateContext): boolean {
  if (ctx.countdownActive) return false;
  return ctx.skillCooldownReady && isGroundLocomotion(ctx.playerState);
}

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
    attack: { enabled: attackEnabled(ctx), label: '攻撃' },
    skill: { enabled: skillEnabled(ctx), label: 'スキル' },
    burst: { enabled: burstEnabled(ctx), label: 'バースト' },
    jump: { enabled: jumpEnabled(), label: jumpButtonLabel(ctx.playerState) },
    sprint: { enabled: sprintEnabled(), label: sprintButtonLabel(ctx.playerState) },
    interact: { enabled: interactEnabled(ctx), label: 'インタラクト' },
  };
}
