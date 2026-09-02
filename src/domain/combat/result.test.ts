import { describe, expect, it } from 'vitest';
import {
  createStats,
  evaluateResult,
  formatClearTime,
  freezeStats,
  recordDamageTaken,
  recordDefeat,
  tickClearTime,
} from './result';

const patrol = (defeated: boolean) => ({ isDefeatTarget: true, defeated });
const dummy = { isDefeatTarget: false, defeated: false };

describe('結果判定(F04 撃破・敗北)', () => {
  it('徘徊型 2 体を撃破すると勝利(ダミーは残っていてよい)', () => {
    expect(evaluateResult(50, [dummy, patrol(true), patrol(true)])).toBe('victory');
  });
  it('1 体残っていれば未決', () => {
    expect(evaluateResult(50, [dummy, patrol(true), patrol(false)])).toBeNull();
  });
  it('プレイヤー HP 0 で敗北。勝利と同時なら敗北を優先', () => {
    expect(evaluateResult(0, [patrol(false), patrol(false)])).toBe('defeat');
    expect(evaluateResult(0, [patrol(true), patrol(true)])).toBe('defeat');
  });
});

describe('統計(S04)', () => {
  it('撃破対象の総数は 2(ダミーを含まない)', () => {
    expect(createStats([dummy, patrol(false), patrol(false)]).totalTargets).toBe(2);
  });
  it('被ダメージ・撃破数・経過時間を集計する', () => {
    let s = createStats([patrol(false), patrol(false)]);
    s = recordDamageTaken(s, 15);
    s = recordDefeat(s);
    s = tickClearTime(s, 1 / 60);
    expect(s.damageTaken).toBe(15);
    expect(s.defeated).toBe(1);
    expect(s.clearTime).toBeCloseTo(1 / 60);
  });
  it('凍結後は集計・経過時間が変わらない', () => {
    let s = freezeStats(createStats([patrol(false)]));
    s = recordDamageTaken(s, 15);
    s = recordDefeat(s);
    s = tickClearTime(s, 1);
    expect(s.damageTaken).toBe(0);
    expect(s.defeated).toBe(0);
    expect(s.clearTime).toBe(0);
  });
});

describe('クリアタイムの書式(mm:ss.ff)', () => {
  it('83.45 秒は 01:23.45', () => {
    expect(formatClearTime(83.45)).toBe('01:23.45');
  });
  it('0 未満は 00:00.00', () => {
    expect(formatClearTime(-1)).toBe('00:00.00');
  });
  it('0.5 秒は 00:00.50', () => {
    expect(formatClearTime(0.5)).toBe('00:00.50');
  });
});
