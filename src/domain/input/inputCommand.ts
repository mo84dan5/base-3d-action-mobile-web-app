// 入力デバイス層(infrastructure / ui)が発行し、ゲームロジックが受け取る入力コマンド(F03「入力コマンドの抽象化」)。
// 状態に応じた解釈(崖ジャンプ・離す・滑空)はゲームロジック側で行う。

export type InputCommand =
  | { readonly type: 'Move'; readonly x: number; readonly y: number }
  | { readonly type: 'Look'; readonly dx: number; readonly dy: number }
  | { readonly type: 'LookEnd' }
  | { readonly type: 'Zoom'; readonly delta: number }
  | { readonly type: 'AttackPressed' }
  | { readonly type: 'AttackHoldStart' }
  | { readonly type: 'AttackHoldEnd' }
  | { readonly type: 'SkillPressed' }
  | { readonly type: 'SkillHoldStart' }
  | { readonly type: 'SkillHoldEnd' }
  | { readonly type: 'BurstPressed' }
  | { readonly type: 'JumpPressed' }
  | { readonly type: 'DashPressed' }
  | { readonly type: 'SprintHoldStart' }
  | { readonly type: 'SprintHoldEnd' }
  | { readonly type: 'InteractPressed' }
  | { readonly type: 'PausePressed' };

export type InputCommandType = InputCommand['type'];

/** 同一フレームで複数成立したときに 1 つだけ処理する優先順(F03)。 */
export const FRAME_COMMAND_PRIORITY: readonly InputCommandType[] = [
  'JumpPressed',
  'DashPressed',
  'BurstPressed',
  'SkillPressed',
  'AttackPressed',
];
