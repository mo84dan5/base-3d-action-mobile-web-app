import { describe, expect, it } from 'vitest';
import { findAttackStyle } from '../attackStyle/attackStyleCatalog';
import type { AttackStyleDefinition } from '../attackStyle/actionSpec';
import { NO_INPUT, type PlayerStepInput } from './playerStep';
import { MULTIHIT_SPIN_TURNS_PER_SECOND, spinRateOf } from './playerSpin';
import { Sim } from './testHarness';

const style = (id: string): AttackStyleDefinition => {
  const found = findAttackStyle(id);
  if (!found) throw new Error(id);
  return found;
};
const withStyle = (id: string, extra: Partial<PlayerStepInput> = {}): PlayerStepInput => ({
  ...NO_INPUT,
  style: style(id),
  energy: 100,
  ...extra,
});

describe('spinRateOf(回転攻撃の表示回転)', () => {
  it('待機中は 0', () => {
    expect(spinRateOf(new Sim().player)).toBe(0);
  });

  it('回転斬りの長押し(リング判定の多段ヒット)中は 2 回転/秒', () => {
    const s = new Sim();
    s.step(withStyle('spin_slash', { attackHoldStart: true }));
    expect(s.player.name).toBe('multihit');
    expect(spinRateOf(s.player)).toBeCloseTo(MULTIHIT_SPIN_TURNS_PER_SECOND * Math.PI * 2, 6);
  });

  it('棍術の長押し(連続回転)もリング判定なので回る', () => {
    const s = new Sim();
    s.step(withStyle('staff', { attackHoldStart: true }));
    expect(s.player.name).toBe('multihit');
    expect(spinRateOf(s.player)).toBeGreaterThan(0);
  });

  it('薙刀の長押し(リング判定の範囲攻撃)中は行動時間 0.9 秒で 1 回転', () => {
    const s = new Sim();
    s.step(withStyle('naginata', { attackHoldStart: true }));
    expect(s.player.name).toBe('area');
    expect(spinRateOf(s.player)).toBeCloseTo((Math.PI * 2) / 0.9, 6);
  });

  it('球判定の斬撃(格闘の押下)や扇形の薙ぎ(棍術の押下)は回らない', () => {
    const melee = new Sim();
    melee.step(withStyle('melee', { attack: true }));
    expect(melee.player.name).toBe('attack');
    expect(spinRateOf(melee.player)).toBe(0);
    const staff = new Sim();
    staff.step(withStyle('staff', { attack: true }));
    expect(staff.player.name).toBe('area');
    expect(spinRateOf(staff.player)).toBe(0);
  });
});
