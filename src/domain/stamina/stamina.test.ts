import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/gameConfig';
import {
  consumeStamina,
  createStamina,
  drainStamina,
  isStaminaLow,
  regenerateStamina,
} from './stamina';

const config = defaultConfig.stamina;

describe('スタミナ(F01)', () => {
  it('ダッシュで 18 消費し、回復遅延 1.0 秒が設定される', () => {
    const s = consumeStamina(createStamina(config), config.dashCost, config);
    expect(s.value).toBe(82);
    expect(s.regenDelayRemaining).toBe(1.0);
  });
  it('残量 10 でダッシュ(18)すると 0 になる(負にならない)', () => {
    const s = consumeStamina({ value: 10, regenDelayRemaining: 0 }, 18, config);
    expect(s.value).toBe(0);
  });
  it('スプリントは毎秒 15 減る', () => {
    const s = drainStamina(createStamina(config), config.sprintCostPerSecond, 1, config);
    expect(s.value).toBe(85);
  });
  it('消費停止から 1 秒は回復せず、その後毎秒 25 回復する', () => {
    let s = consumeStamina(createStamina(config), 50, config);
    s = regenerateStamina(s, 0.5, true, config);
    expect(s.value).toBe(50);
    s = regenerateStamina(s, 0.5, true, config);
    expect(s.value).toBe(50);
    s = regenerateStamina(s, 1, true, config);
    expect(s.value).toBe(75);
  });
  it('遅延の終了ステップでは残り時間分だけ回復する', () => {
    let s = { value: 50, regenDelayRemaining: 0.01 };
    s = regenerateStamina(s, 0.05, true, config);
    expect(s.value).toBeCloseTo(50 + 25 * 0.04);
  });
  it('回復条件を満たさない間(空中・Slide)は遅延タイマーも進まない', () => {
    let s = consumeStamina(createStamina(config), 50, config);
    s = regenerateStamina(s, 5, false, config);
    expect(s.value).toBe(50);
    expect(s.regenDelayRemaining).toBe(1.0);
  });
  it('最大値を超えない', () => {
    const s = regenerateStamina({ value: 99, regenDelayRemaining: 0 }, 1, true, config);
    expect(s.value).toBe(100);
  });
  it('20% 以下で低スタミナ', () => {
    expect(isStaminaLow({ value: 20, regenDelayRemaining: 0 }, config)).toBe(true);
    expect(isStaminaLow({ value: 21, regenDelayRemaining: 0 }, config)).toBe(false);
  });
});
