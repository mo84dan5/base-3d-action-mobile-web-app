import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/gameConfig';
import {
  advanceDistanceThisStep,
  attackPhase,
  canCancelAttack,
  isInActiveWindow,
  nextComboStage,
} from './comboState';

const [stage1, , stage3] = defaultConfig.combat.normalAttack;

describe('コンボ段の決定(F04 通常攻撃)', () => {
  it('未攻撃から 1 段目、猶予内なら 1 → 2 → 3', () => {
    expect(nextComboStage(0, 0)).toBe(1);
    expect(nextComboStage(1, 0.5)).toBe(2);
    expect(nextComboStage(2, 0.5)).toBe(3);
  });
  it('3 段目の後は猶予内でも 1 段目に戻る', () => {
    expect(nextComboStage(3, 0.8)).toBe(1);
  });
  it('1 段目のあと 0.8 秒の猶予を超えると 1 段目に戻る', () => {
    expect(nextComboStage(1, 0)).toBe(1);
  });
});

describe('攻撃のフェーズ(1 段: 発生 0.10 / 持続 0.10 / 全体 0.40 秒)', () => {
  it('0.05 秒は発生、0.15 秒は持続、0.3 秒は後隙、0.4 秒で終了', () => {
    expect(attackPhase(0.05, stage1)).toBe('startup');
    expect(attackPhase(0.15, stage1)).toBe('active');
    expect(attackPhase(0.3, stage1)).toBe('recovery');
    expect(attackPhase(0.4, stage1)).toBe('done');
    expect(isInActiveWindow(0.15, stage1)).toBe(true);
    expect(isInActiveWindow(0.05, stage1)).toBe(false);
  });
  it('発生前(0.10 秒未満)のみキャンセル可', () => {
    expect(canCancelAttack(0.09, stage1)).toBe(true);
    expect(canCancelAttack(0.1, stage1)).toBe(false);
  });
});

describe('前進量(F04 発生〜持続の間に等速)', () => {
  it('3 段目は 0.30 秒で 0.5 m 進む。1 ステップ(1/60 秒)では 0.5 / 18 m', () => {
    expect(advanceDistanceThisStep(0, 1 / 60, stage3)).toBeCloseTo(0.5 / 18);
  });
  it('発生〜持続を跨ぐ全区間で合計 0.3 m(1 段)', () => {
    let total = 0;
    for (let t = 0; t < stage1.total; t += 1 / 60)
      total += advanceDistanceThisStep(t, 1 / 60, stage1);
    expect(total).toBeCloseTo(0.3);
  });
  it('後隙では前進しない', () => {
    expect(advanceDistanceThisStep(0.3, 1 / 60, stage1)).toBe(0);
  });
});
