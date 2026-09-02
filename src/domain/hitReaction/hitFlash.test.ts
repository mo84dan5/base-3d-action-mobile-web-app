import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/gameConfig';
import { flashIntensity, flashOpacity, startFlash, tickFlash } from './hitFlash';

const config = defaultConfig.hitReaction;

describe('ヒットフラッシュ(F10)', () => {
  it('開始直後は 6 ステップ残り・強度 1', () => {
    const f = startFlash('white', config);
    expect(f.remainingSteps).toBe(6);
    expect(flashIntensity(f)).toBe(1);
  });
  it('3 ステップ後の強度は 0.5', () => {
    let f = startFlash('white', config) as ReturnType<typeof tickFlash>;
    f = tickFlash(tickFlash(tickFlash(f)));
    expect(flashIntensity(f)).toBeCloseTo(0.5);
  });
  it('6 ステップで終了して null になる', () => {
    let f = startFlash('white', config) as ReturnType<typeof tickFlash>;
    for (let i = 0; i < 6; i++) f = tickFlash(f);
    expect(f).toBeNull();
    expect(flashIntensity(f)).toBe(0);
  });
  it('プレイヤーの赤フラッシュは不透明 0.8 から始まり、白は 1.0', () => {
    expect(flashOpacity(startFlash('red', config))).toBeCloseTo(0.8);
    expect(flashOpacity(startFlash('white', config))).toBe(1);
  });
  it('重複時は再スタートして残りが 6 に戻る', () => {
    const half = tickFlash(tickFlash(tickFlash(startFlash('white', config))));
    expect(half?.remainingSteps).toBe(3);
    expect(startFlash('white', config).remainingSteps).toBe(6);
  });
});
