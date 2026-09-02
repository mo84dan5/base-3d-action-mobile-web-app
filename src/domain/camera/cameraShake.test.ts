import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/gameConfig';
import { NO_SHAKE, currentAmplitude, requestShake, shakeOffset, tickShake } from './cameraShake';

const config = defaultConfig.hitReaction;
const rngQuarter = () => 0.25;

describe('requestShake(F10 カメラシェイク 重複)', () => {
  it('通常攻撃 3 段(0.05 m, 7 ステップ)を開始できる', () => {
    const shake = requestShake(NO_SHAKE, config.shake.normal3, rngQuarter, config);
    expect(shake.amplitude).toBe(0.05);
    expect(shake.remainingSteps).toBe(7);
    expect(shake.totalSteps).toBe(7);
  });
  it('大きい振幅の要求は現在のシェイクを置き換える(加算しない)', () => {
    const small = requestShake(NO_SHAKE, config.shake.normal3, rngQuarter, config);
    const replaced = requestShake(small, config.shake.playerHit, rngQuarter, config);
    expect(replaced.amplitude).toBe(0.1);
    expect(replaced.remainingSteps).toBe(12);
  });
  it('残り振幅より小さい要求は無視される', () => {
    const big = requestShake(NO_SHAKE, config.shake.burst, rngQuarter, config);
    const ignored = requestShake(big, config.shake.normal3, rngQuarter, config);
    expect(ignored).toBe(big);
  });
  it('減衰して残り振幅が小さくなれば、より小さい要求でも置き換わる', () => {
    let shake = requestShake(NO_SHAKE, config.shake.playerHit, rngQuarter, config);
    for (let i = 0; i < 10; i++) shake = tickShake(shake);
    expect(currentAmplitude(shake)).toBeCloseTo(0.1 * (2 / 12));
    const next = requestShake(shake, config.shake.normal3, rngQuarter, config);
    expect(next.amplitude).toBe(0.05);
  });
  it('振幅 0.2 m・持続 30 ステップを超える要求はクランプされる', () => {
    const shake = requestShake(NO_SHAKE, { amplitude: 1.0, steps: 100 }, rngQuarter, config);
    expect(shake.amplitude).toBe(0.2);
    expect(shake.totalSteps).toBe(30);
  });
  it('位相は rng から決まる', () => {
    const shake = requestShake(NO_SHAKE, config.shake.skill, rngQuarter, config);
    expect(shake.phaseX).toBeCloseTo(Math.PI / 2);
  });
});

describe('tickShake / currentAmplitude(線形減衰)', () => {
  it('毎ステップ振幅が線形に減り、終了後は 0', () => {
    let shake = requestShake(NO_SHAKE, config.shake.normal3, rngQuarter, config);
    expect(currentAmplitude(shake)).toBeCloseTo(0.05);
    shake = tickShake(shake);
    expect(currentAmplitude(shake)).toBeCloseTo(0.05 * (6 / 7));
    for (let i = 0; i < 6; i++) shake = tickShake(shake);
    expect(shake).toEqual(NO_SHAKE);
    expect(currentAmplitude(shake)).toBe(0);
  });
});

describe('shakeOffset(25 Hz 正弦波)', () => {
  it('シェイクなしではオフセット 0', () => {
    expect(shakeOffset(NO_SHAKE, config)).toEqual({ x: 0, y: 0 });
  });
  it('オフセットの大きさは残り振幅を超えない', () => {
    let shake = requestShake(NO_SHAKE, config.shake.burst, () => 0.9, config);
    for (let i = 0; i < 18; i++) {
      const offset = shakeOffset(shake, config);
      expect(Math.abs(offset.x)).toBeLessThanOrEqual(currentAmplitude(shake) + 1e-9);
      expect(Math.abs(offset.y)).toBeLessThanOrEqual(currentAmplitude(shake) + 1e-9);
      shake = tickShake(shake);
    }
  });
  it('開始時(t = 0)は位相 π/2 で最大振幅', () => {
    const shake = requestShake(NO_SHAKE, config.shake.playerHit, rngQuarter, config);
    expect(shakeOffset(shake, config).x).toBeCloseTo(0.1);
  });
});
