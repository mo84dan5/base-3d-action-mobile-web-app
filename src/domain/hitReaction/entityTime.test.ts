import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/gameConfig';
import {
  applyAttackerHitstop,
  createAttackerHitstopBudget,
  requestHitstop,
  tickHitstop,
  timeScale,
} from './entityTime';

const config = defaultConfig.hitReaction;

describe('ヒットストップ(F10 エンティティ時間)', () => {
  it('残り 3 ステップ中に 5 ステップの要求が来ると 8 ではなく 5 に置き換わる', () => {
    expect(requestHitstop(3, 5)).toBe(5);
  });
  it('残り 5 ステップ中に 3 ステップの要求が来ても 5 のまま', () => {
    expect(requestHitstop(5, 3)).toBe(5);
  });
  it('1 ステップ進めると 1 減り、0 未満にならない', () => {
    expect(tickHitstop(5)).toBe(4);
    expect(tickHitstop(0)).toBe(0);
  });
  it('残りがあれば時間スケール 0、なければ 1', () => {
    expect(timeScale(1)).toBe(0);
    expect(timeScale(0)).toBe(1);
  });
});

describe('攻撃側ヒットストップの上限(F10 上限 10 ステップ)', () => {
  it('1 回の攻撃で 8 ステップの後に 8 ステップを要求すると残り 2 ステップだけ付与される', () => {
    const first = applyAttackerHitstop(0, 8, createAttackerHitstopBudget(1), config);
    expect(first.steps).toBe(8);
    expect(first.budget.usedSteps).toBe(8);
    const second = applyAttackerHitstop(0, 8, first.budget, config);
    expect(second.steps).toBe(2);
    expect(second.budget.usedSteps).toBe(10);
  });
  it('上限に達した後は付与されない', () => {
    const exhausted = { attackId: 1, usedSteps: 10 };
    expect(applyAttackerHitstop(0, 5, exhausted, config).steps).toBe(0);
  });
  it('現在の残りが要求より大きければ残りを維持する', () => {
    expect(applyAttackerHitstop(4, 3, createAttackerHitstopBudget(2), config).steps).toBe(4);
  });
});
