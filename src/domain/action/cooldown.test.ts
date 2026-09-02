import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/gameConfig';
import {
  cooldownRatio,
  isReady,
  READY_COOLDOWN,
  remainingSecondsLabel,
  startCooldown,
  tickCooldown,
} from './cooldown';

describe('クールダウン(F03)', () => {
  it('スキル発動で 8.0 秒のクールダウンが始まり、8 秒後に準備完了になる', () => {
    let c = startCooldown(defaultConfig.action.skillCooldown);
    expect(isReady(c)).toBe(false);
    c = tickCooldown(c, 7.99);
    expect(isReady(c)).toBe(false);
    c = tickCooldown(c, 0.01);
    expect(isReady(c)).toBe(true);
    expect(c.remaining).toBe(0);
  });
  it('準備完了状態は tick しても変わらない', () => {
    expect(tickCooldown(READY_COOLDOWN, 1)).toBe(READY_COOLDOWN);
  });
  it('リング比率は開始直後 1、半分で 0.5、完了で 0', () => {
    const c = startCooldown(8);
    expect(cooldownRatio(c)).toBe(1);
    expect(cooldownRatio(tickCooldown(c, 4))).toBe(0.5);
    expect(cooldownRatio(tickCooldown(c, 8))).toBe(0);
  });
  it('残り秒数の表示は 1 秒以上で切り上げ整数、1 秒未満で小数 1 桁', () => {
    expect(remainingSecondsLabel(startCooldown(8))).toBe('8');
    expect(remainingSecondsLabel({ remaining: 7.2, duration: 8 })).toBe('8');
    expect(remainingSecondsLabel({ remaining: 1.0, duration: 8 })).toBe('1');
    expect(remainingSecondsLabel({ remaining: 0.5, duration: 8 })).toBe('0.5');
    expect(remainingSecondsLabel({ remaining: 0.04, duration: 8 })).toBe('0.1');
    expect(remainingSecondsLabel(READY_COOLDOWN)).toBe('');
  });
});
