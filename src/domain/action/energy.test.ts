import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/gameConfig';
import {
  createEnergy,
  energyForHit,
  energyRatio,
  gainEnergy,
  isEnergyFull,
  spendAllEnergy,
} from './energy';

const config = defaultConfig.action;

describe('エネルギー(F03)', () => {
  it('初期値は 0 / 100', () => {
    expect(createEnergy(config)).toEqual({ value: 0, max: 100 });
  });
  it('通常攻撃 20 回ヒットで 100% になりバースト可能', () => {
    let e = createEnergy(config);
    for (let i = 0; i < 19; i++) e = gainEnergy(e, energyForHit('normal', config));
    expect(isEnergyFull(e)).toBe(false);
    e = gainEnergy(e, energyForHit('normal', config));
    expect(isEnergyFull(e)).toBe(true);
  });
  it('スキルヒット 1 体で +15、空中攻撃 +5、バースト 0', () => {
    expect(energyForHit('skill', config)).toBe(15);
    expect(energyForHit('air', config)).toBe(5);
    expect(energyForHit('burst', config)).toBe(0);
  });
  it('最大値を超えず、バースト発動で 0 に戻る', () => {
    const e = gainEnergy({ value: 95, max: 100 }, 15);
    expect(e.value).toBe(100);
    expect(spendAllEnergy(e).value).toBe(0);
  });
  it('リング比率は 50 で 0.5', () => {
    expect(energyRatio({ value: 50, max: 100 })).toBe(0.5);
  });
});
