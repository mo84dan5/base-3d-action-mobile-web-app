import type { InputCommand } from '../domain/input/inputCommand';
import { resolveFrameCommands } from '../domain/input/frameCommandResolver';
import type { StickInput } from '../domain/stick/virtualStick';

// 1 物理ステップぶんの入力。InputCommand の列を集約する(Move は最新値、Look/Zoom は合計、押下は真偽)。
export interface FrameInput {
  readonly stick: StickInput;
  readonly lookDx: number;
  readonly lookDy: number;
  readonly lookEnded: boolean;
  readonly zoom: number;
  readonly attack: boolean;
  readonly attackHoldStart: boolean;
  readonly attackHoldEnd: boolean;
  readonly skill: boolean;
  readonly skillHoldStart: boolean;
  readonly skillHoldEnd: boolean;
  readonly burst: boolean;
  readonly jump: boolean;
  readonly dash: boolean;
  readonly sprintHoldStart: boolean;
  readonly sprintHoldEnd: boolean;
  readonly interact: boolean;
  readonly pause: boolean;
}

export const EMPTY_FRAME_INPUT: FrameInput = {
  stick: { x: 0, y: 0, magnitude: 0 },
  lookDx: 0,
  lookDy: 0,
  lookEnded: false,
  zoom: 0,
  attack: false,
  attackHoldStart: false,
  attackHoldEnd: false,
  skill: false,
  skillHoldStart: false,
  skillHoldEnd: false,
  burst: false,
  jump: false,
  dash: false,
  sprintHoldStart: false,
  sprintHoldEnd: false,
  interact: false,
  pause: false,
};

/** コマンド列を 1 ステップの入力へ集約する。押下系は同一フレーム優先(F03)を適用済みで返す。 */
export function accumulateFrameInput(
  commands: readonly InputCommand[],
  previousStick: StickInput,
): FrameInput {
  let f: FrameInput = { ...EMPTY_FRAME_INPUT, stick: previousStick };
  for (const c of resolveFrameCommands(commands)) {
    switch (c.type) {
      case 'Move': {
        const magnitude = Math.min(1, Math.hypot(c.x, c.y));
        const stick: StickInput =
          magnitude === 0
            ? { x: 0, y: 0, magnitude: 0 }
            : { x: c.x / Math.hypot(c.x, c.y), y: c.y / Math.hypot(c.x, c.y), magnitude };
        f = { ...f, stick };
        break;
      }
      case 'Look':
        f = { ...f, lookDx: f.lookDx + c.dx, lookDy: f.lookDy + c.dy };
        break;
      case 'LookEnd':
        f = { ...f, lookEnded: true };
        break;
      case 'Zoom':
        f = { ...f, zoom: f.zoom + c.delta };
        break;
      case 'AttackPressed':
        f = { ...f, attack: true };
        break;
      case 'AttackHoldStart':
        f = { ...f, attackHoldStart: true };
        break;
      case 'AttackHoldEnd':
        f = { ...f, attackHoldEnd: true };
        break;
      case 'SkillPressed':
        f = { ...f, skill: true };
        break;
      case 'SkillHoldStart':
        f = { ...f, skillHoldStart: true };
        break;
      case 'SkillHoldEnd':
        f = { ...f, skillHoldEnd: true };
        break;
      case 'BurstPressed':
        f = { ...f, burst: true };
        break;
      case 'JumpPressed':
        f = { ...f, jump: true };
        break;
      case 'DashPressed':
        f = { ...f, dash: true };
        break;
      case 'SprintHoldStart':
        f = { ...f, sprintHoldStart: true };
        break;
      case 'SprintHoldEnd':
        f = { ...f, sprintHoldEnd: true };
        break;
      case 'InteractPressed':
        f = { ...f, interact: true };
        break;
      case 'PausePressed':
        f = { ...f, pause: true };
        break;
    }
  }
  return f;
}
