import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/gameConfig';
import { ButtonInputSet, type ButtonKind, ButtonPressTracker } from './buttonPressTracker';

const HOLD = defaultConfig.action.holdThreshold;
const tracker = (kind: ButtonKind) => new ButtonPressTracker(kind, HOLD);

describe('ButtonPressTracker 押下(F03)', () => {
  it('スプリント押下を flush すると DashPressed が 1 回だけ出る', () => {
    const t = tracker('sprint');
    expect(t.press(0)).toEqual({ consumed: true, accepted: true });
    expect(t.flush(0)).toEqual([{ type: 'DashPressed' }]);
    expect(t.flush(0.016)).toEqual([]);
  });
  it('各ボタンが対応する押下コマンドを出す', () => {
    const cases = [
      ['attack', 'AttackPressed'],
      ['skill', 'SkillPressed'],
      ['burst', 'BurstPressed'],
      ['jump', 'JumpPressed'],
      ['interact', 'InteractPressed'],
      ['pause', 'PausePressed'],
    ] as const;
    for (const [kind, type] of cases) {
      const t = tracker(kind);
      t.press(0);
      expect(t.flush(0)).toEqual([{ type }]);
    }
  });
  it('押下中の 2 回目の press は受け付けないがポインタは消費する', () => {
    const t = tracker('attack');
    t.press(0);
    expect(t.press(0.05)).toEqual({ consumed: true, accepted: false });
    expect(t.flush(0.05)).toEqual([{ type: 'AttackPressed' }]);
  });
});

describe('ButtonPressTracker 長押し(F03 200 ms 境界)', () => {
  it('押下から 199 ms では SprintHoldStart が出ず、200 ms で出る', () => {
    const t = tracker('sprint');
    t.press(0);
    t.flush(0);
    expect(t.flush(0.199)).toEqual([]);
    expect(t.flush(0.2)).toEqual([{ type: 'SprintHoldStart' }]);
    expect(t.hasHoldStarted()).toBe(true);
    expect(t.flush(0.3)).toEqual([]);
  });
  it('長押し開始後に離すと SprintHoldEnd が出る', () => {
    const t = tracker('sprint');
    t.press(0);
    t.flush(0.25);
    expect(t.release()).toEqual([{ type: 'SprintHoldEnd' }]);
    expect(t.isHeld()).toBe(false);
  });
  it('長押し開始前に離すと何も出ない(短押しの概念はない)', () => {
    const t = tracker('sprint');
    t.press(0);
    t.flush(0);
    expect(t.release()).toEqual([]);
  });
  it('スキルは SkillHoldStart / SkillHoldEnd を出す', () => {
    const t = tracker('skill');
    t.press(0);
    expect(t.flush(0.2)).toEqual([{ type: 'SkillPressed' }, { type: 'SkillHoldStart' }]);
    expect(t.release()).toEqual([{ type: 'SkillHoldEnd' }]);
  });
  it('ジャンプ・攻撃は 1 秒押しても長押しイベントを出さない', () => {
    for (const kind of ['jump', 'attack', 'burst', 'interact', 'pause'] as const) {
      const t = tracker(kind);
      t.press(0);
      t.flush(0);
      expect(t.flush(1.0)).toEqual([]);
      expect(t.release()).toEqual([]);
    }
  });
});

describe('ButtonPressTracker 強制解放(F03 / F09 キャンセル)', () => {
  it('押下から 100 ms 後(flush 前)にキャンセルすると DashPressed が発火しない', () => {
    const t = tracker('sprint');
    t.press(0);
    expect(t.cancel()).toEqual([]);
    expect(t.flush(0.1)).toEqual([]);
    expect(t.isHeld()).toBe(false);
  });
  it('長押し開始済みでキャンセルすると SprintHoldEnd を出し、以降 flush しても何も出ない', () => {
    const t = tracker('sprint');
    t.press(0);
    t.flush(0.2);
    expect(t.cancel()).toEqual([{ type: 'SprintHoldEnd' }]);
    expect(t.flush(0.5)).toEqual([]);
  });
  it('キャンセル後に押し直すと再び受け付ける', () => {
    const t = tracker('sprint');
    t.press(0);
    t.cancel();
    expect(t.press(0.5).accepted).toBe(true);
    expect(t.flush(0.5)).toEqual([{ type: 'DashPressed' }]);
  });
});

describe('ButtonPressTracker 無効状態と出現直後ロック(F03)', () => {
  it('無効ボタンの押下はポインタを消費するがコマンドを出さない', () => {
    const t = tracker('skill');
    t.setEnabled(false);
    expect(t.press(0)).toEqual({ consumed: true, accepted: false });
    expect(t.flush(0)).toEqual([]);
  });
  it('出現から 150 ms 以内の押下は無視され、150 ms 以降は受け付ける', () => {
    const t = tracker('interact');
    t.lockFor(defaultConfig.action.appearLockTime, 1.0);
    expect(t.press(1.1).accepted).toBe(false);
    expect(t.flush(1.1)).toEqual([]);
    expect(t.press(1.15).accepted).toBe(true);
    expect(t.flush(1.15)).toEqual([{ type: 'InteractPressed' }]);
  });
});

describe('ButtonInputSet', () => {
  it('cancelAll は長押し中のボタンの HoldEnd だけを返し、保留中の押下を破棄する', () => {
    const set = new ButtonInputSet(defaultConfig.action);
    set.press('sprint', 0);
    set.flush(0.2);
    set.press('skill', 0.25);
    set.press('jump', 0.25);
    expect(set.cancelAll()).toEqual([{ type: 'SprintHoldEnd' }]);
    expect(set.flush(0.3)).toEqual([]);
  });
  it('flush は全ボタンの保留コマンドをまとめて返す', () => {
    const set = new ButtonInputSet(defaultConfig.action);
    set.press('jump', 0);
    set.press('attack', 0);
    expect(set.flush(0)).toEqual([{ type: 'AttackPressed' }, { type: 'JumpPressed' }]);
  });
  it('setEnabled / lockFor が対象ボタンに反映される', () => {
    const set = new ButtonInputSet(defaultConfig.action);
    set.setEnabled('burst', false);
    expect(set.press('burst', 0).accepted).toBe(false);
    set.lockFor('interact', 0.15, 0);
    expect(set.press('interact', 0.1).accepted).toBe(false);
  });
});
