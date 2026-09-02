import { describe, expect, it } from 'vitest';
import type { InputCommand } from './inputCommand';
import { resolveFrameCommands } from './frameCommandResolver';

describe('resolveFrameCommands(F03 同一フレームの優先解決)', () => {
  it('攻撃・スキル・ジャンプが同時ならジャンプだけ残る', () => {
    const input: InputCommand[] = [
      { type: 'AttackPressed' },
      { type: 'SkillPressed' },
      { type: 'JumpPressed' },
    ];
    expect(resolveFrameCommands(input)).toEqual([{ type: 'JumpPressed' }]);
  });
  it('ダッシュとバーストならダッシュ、バーストとスキルならバースト', () => {
    expect(resolveFrameCommands([{ type: 'BurstPressed' }, { type: 'DashPressed' }])).toEqual([
      { type: 'DashPressed' },
    ]);
    expect(resolveFrameCommands([{ type: 'SkillPressed' }, { type: 'BurstPressed' }])).toEqual([
      { type: 'BurstPressed' },
    ]);
  });
  it('Move / Look / HoldStart / Interact / Pause は順序を保ってそのまま通す', () => {
    const input: InputCommand[] = [
      { type: 'Move', x: 0.5, y: 0.2 },
      { type: 'AttackPressed' },
      { type: 'Look', dx: 3, dy: -1 },
      { type: 'SprintHoldStart' },
      { type: 'InteractPressed' },
      { type: 'PausePressed' },
      { type: 'LookEnd' },
      { type: 'Zoom', delta: 0.5 },
    ];
    expect(resolveFrameCommands(input)).toEqual(input);
  });
  it('排他コマンドが無ければ入力をそのまま返す', () => {
    const input: InputCommand[] = [{ type: 'Move', x: 0, y: 1 }];
    expect(resolveFrameCommands(input)).toEqual(input);
  });
  it('同種の押下が 2 つあっても 1 つだけ残る', () => {
    expect(resolveFrameCommands([{ type: 'AttackPressed' }, { type: 'AttackPressed' }])).toEqual([
      { type: 'AttackPressed' },
    ]);
  });
});
