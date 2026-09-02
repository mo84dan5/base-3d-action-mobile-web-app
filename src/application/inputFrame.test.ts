import { describe, expect, it } from 'vitest';
import { accumulateFrameInput } from './inputFrame';

const noStick = { x: 0, y: 0, magnitude: 0 };

describe('1 ステップの入力集約', () => {
  it('Move は最新値を採用し、Look は合計する', () => {
    const f = accumulateFrameInput(
      [
        { type: 'Move', x: 0, y: 0.5 },
        { type: 'Move', x: 1, y: 0 },
        { type: 'Look', dx: 3, dy: -2 },
        { type: 'Look', dx: 1, dy: 1 },
      ],
      noStick,
    );
    expect(f.stick).toEqual({ x: 1, y: 0, magnitude: 1 });
    expect(f.lookDx).toBe(4);
    expect(f.lookDy).toBe(-1);
  });
  it('Move が無いフレームは前回のスティック値を保持する', () => {
    const f = accumulateFrameInput([], { x: 0, y: 1, magnitude: 0.5 });
    expect(f.stick.magnitude).toBe(0.5);
  });
  it('同一フレームのジャンプと攻撃はジャンプだけが残る(F03 同時押し)', () => {
    const f = accumulateFrameInput([{ type: 'AttackPressed' }, { type: 'JumpPressed' }], noStick);
    expect(f.jump).toBe(true);
    expect(f.attack).toBe(false);
  });
  it('長押し開始 / 終了とポーズはそのまま通る', () => {
    const f = accumulateFrameInput(
      [{ type: 'SprintHoldStart' }, { type: 'PausePressed' }, { type: 'DashPressed' }],
      noStick,
    );
    expect(f.sprintHoldStart).toBe(true);
    expect(f.pause).toBe(true);
    expect(f.dash).toBe(true);
  });
});
