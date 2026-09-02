import { describe, expect, it } from 'vitest';
import { advanceLoop, initialAccumulator } from './gameLoop';

describe('固定タイムステップ(F05 更新ループ)', () => {
  it('60 fps のフレームでは 1 ステップ', () => {
    const r = advanceLoop(initialAccumulator, 1 / 60);
    expect(r.steps).toBe(1);
    expect(r.alpha).toBeCloseTo(0, 5);
  });
  it('30 fps のフレームでは 2 ステップ(移動距離が変わらない)', () => {
    const r = advanceLoop(initialAccumulator, 1 / 30);
    expect(r.steps).toBe(2);
  });
  it('1 フレームの遅延が 4 ステップを超えた分は捨てる', () => {
    const r = advanceLoop(initialAccumulator, 0.5);
    expect(r.steps).toBe(4);
    expect(r.accumulator.accumulated).toBeCloseTo(0, 5);
  });
  it('端数は次のフレームへ持ち越し、補間係数になる', () => {
    const r = advanceLoop(initialAccumulator, 1 / 60 + 1 / 120);
    expect(r.steps).toBe(1);
    expect(r.alpha).toBeCloseTo(0.5, 5);
    const r2 = advanceLoop(r.accumulator, 1 / 120);
    expect(r2.steps).toBe(1);
  });
});
