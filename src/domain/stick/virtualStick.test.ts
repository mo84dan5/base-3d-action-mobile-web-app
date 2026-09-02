import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/gameConfig';
import {
  canStartFixedStick,
  computeStickInput,
  isRunMagnitude,
  keyboardStick,
  knobPosition,
  stickToWorldDirection,
  targetSpeedFor,
} from './virtualStick';

const stick = defaultConfig.stick;
const center = { x: 100, y: 100 };

describe('computeStickInput(F01 バーチャルスティック)', () => {
  it('デッドゾーン(外円 60 px の 15% = 9 px)以内は入力 0', () => {
    expect(computeStickInput(center, { x: 108, y: 100 }, stick).magnitude).toBe(0);
    expect(computeStickInput(center, { x: 109, y: 100 }, stick).magnitude).toBe(0);
  });
  it('外円(60 px)で大きさ 1.0、それ以上でも 1.0 に制限', () => {
    expect(computeStickInput(center, { x: 160, y: 100 }, stick).magnitude).toBeCloseTo(1);
    expect(computeStickInput(center, { x: 200, y: 100 }, stick).magnitude).toBe(1);
  });
  it('デッドゾーンと外円の中点(34.5 px)で大きさ 0.5', () => {
    expect(computeStickInput(center, { x: 134.5, y: 100 }, stick).magnitude).toBeCloseTo(0.5);
  });
  it('画面上へ動かすと前(y = +1)、右へ動かすと x = +1 の単位方向', () => {
    const up = computeStickInput(center, { x: 100, y: 40 }, stick);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(1);
    const right = computeStickInput(center, { x: 160, y: 100 }, stick);
    expect(right.x).toBeCloseTo(1);
    expect(right.y).toBeCloseTo(0);
  });
});

describe('knobPosition', () => {
  it('外円半径以内ならポインタ位置そのもの', () => {
    expect(knobPosition(center, { x: 130, y: 100 }, 60)).toEqual({ x: 130, y: 100 });
  });
  it('外円半径を超えると半径 60 px の円周上に制限される', () => {
    const knob = knobPosition(center, { x: 220, y: 100 }, 60);
    expect(knob).toEqual({ x: 160, y: 100 });
  });
});

describe('canStartFixedStick(F01 固定モードの操作開始範囲)', () => {
  it('外円半径の 1.5 倍(90 px)以内で開始できる', () => {
    expect(canStartFixedStick(center, { x: 190, y: 100 }, stick)).toBe(true);
    expect(canStartFixedStick(center, { x: 191, y: 100 }, stick)).toBe(false);
  });
});

describe('isRunMagnitude(F01 歩き/走りの閾値)', () => {
  it('0.6 以上で走り、0.6 未満で歩き', () => {
    expect(isRunMagnitude(0.6, stick)).toBe(true);
    expect(isRunMagnitude(0.59, stick)).toBe(false);
  });
  it('targetSpeedFor は歩き 1.8 m/s・走り 4.5 m/s・入力 0 で 0', () => {
    expect(targetSpeedFor(0.3, stick, defaultConfig.movement)).toBe(1.8);
    expect(targetSpeedFor(1.0, stick, defaultConfig.movement)).toBe(4.5);
    expect(targetSpeedFor(0, stick, defaultConfig.movement)).toBe(0);
  });
});

describe('stickToWorldDirection(F01 カメラ基準の方向)', () => {
  it('カメラヨー 0 でスティック前は世界 +z', () => {
    const dir = stickToWorldDirection({ x: 0, y: 1, magnitude: 1 }, 0);
    expect(dir.x).toBeCloseTo(0);
    expect(dir.z).toBeCloseTo(1);
    expect(dir.y).toBe(0);
  });
  it('カメラヨー 0 でスティック右は右手系の right = cross(forward, UP) = 世界 −x', () => {
    const dir = stickToWorldDirection({ x: 1, y: 0, magnitude: 1 }, 0);
    expect(dir.x).toBeCloseTo(-1);
    expect(dir.z).toBeCloseTo(0);
  });
  it('カメラヨー π/2(前 = +x)でスティック前は世界 +x', () => {
    const dir = stickToWorldDirection({ x: 0, y: 1, magnitude: 1 }, Math.PI / 2);
    expect(dir.x).toBeCloseTo(1);
    expect(dir.z).toBeCloseTo(0);
  });
  it('大きさ 0.5 の入力は長さ 0.5 のベクトル、入力 0 は零ベクトル', () => {
    const dir = stickToWorldDirection({ x: 0, y: 1, magnitude: 0.5 }, 0);
    expect(dir.z).toBeCloseTo(0.5);
    expect(stickToWorldDirection({ x: 0, y: 0, magnitude: 0 }, 1.2)).toEqual({ x: 0, y: 0, z: 0 });
  });
  it('俯瞰していても水平ベクトル(y = 0)になる', () => {
    expect(stickToWorldDirection({ x: 0.6, y: 0.8, magnitude: 1 }, 0.4).y).toBe(0);
  });
});

describe('keyboardStick(S02 補助入力)', () => {
  it('W は前方向・大きさ 1.0(走り)', () => {
    expect(keyboardStick({ w: true, a: false, s: false, d: false }, false)).toEqual({
      x: 0,
      y: 1,
      magnitude: 1,
    });
  });
  it('Ctrl + W は大きさ 0.5(歩き)', () => {
    expect(keyboardStick({ w: true, a: false, s: false, d: false }, true).magnitude).toBe(0.5);
  });
  it('W + D は右前 45 度の単位方向', () => {
    const input = keyboardStick({ w: true, a: false, s: false, d: true }, false);
    expect(input.x).toBeCloseTo(Math.SQRT1_2);
    expect(input.y).toBeCloseTo(Math.SQRT1_2);
  });
  it('W + S(相殺)は入力 0', () => {
    expect(keyboardStick({ w: true, a: false, s: true, d: false }, false).magnitude).toBe(0);
  });
});
