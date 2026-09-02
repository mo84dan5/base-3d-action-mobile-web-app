import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/gameConfig';
import {
  canStepUp,
  classifySurface,
  integrateGravity,
  jumpApexHeight,
  slideAcceleration,
} from './surface';

const physics = defaultConfig.physics;
const normalYOfSlope = (deg: number) => Math.cos((deg * Math.PI) / 180);

describe('classifySurface(F05 地形面の区分)', () => {
  it('斜度 0 度・20 度・35 度は歩行可能面', () => {
    expect(classifySurface(1, physics)).toBe('walkable');
    expect(classifySurface(normalYOfSlope(20), physics)).toBe('walkable');
    expect(classifySurface(normalYOfSlope(35), physics)).toBe('walkable');
  });
  it('斜度 36 度・45 度・59 度は滑り面', () => {
    expect(classifySurface(normalYOfSlope(36), physics)).toBe('slide');
    expect(classifySurface(normalYOfSlope(45), physics)).toBe('slide');
    expect(classifySurface(normalYOfSlope(59), physics)).toBe('slide');
  });
  it('斜度 60 度・90 度・法線 y −0.1 は壁', () => {
    expect(classifySurface(normalYOfSlope(60), physics)).toBe('wall');
    expect(classifySurface(0, physics)).toBe('wall');
    expect(classifySurface(-0.1, physics)).toBe('wall');
  });
  it('法線 y が −0.1 未満は天井', () => {
    expect(classifySurface(-0.11, physics)).toBe('ceiling');
    expect(classifySurface(-1, physics)).toBe('ceiling');
  });
});

describe('integrateGravity', () => {
  it('1/60 秒で 20 m/s² だけ減速する', () => {
    expect(integrateGravity(0, 1 / 60, physics)).toBeCloseTo(-20 / 60);
  });
  it('終端速度 30 m/s を超えない', () => {
    expect(integrateGravity(-29.9, 1, physics)).toBe(-30);
  });
});

describe('canStepUp', () => {
  it('接地中の 0.3 m 段差は乗れる', () => {
    expect(canStepUp(0.3, true, physics)).toBe(true);
  });
  it('0.5 m 段差は乗れない', () => {
    expect(canStepUp(0.5, true, physics)).toBe(false);
  });
  it('空中では 0.3 m でも乗れない', () => {
    expect(canStepUp(0.3, false, physics)).toBe(false);
  });
});

describe('slideAcceleration', () => {
  it('45 度の滑り面では重力 × sin45 の加速度', () => {
    expect(slideAcceleration(normalYOfSlope(45), physics)).toBeCloseTo(20 * Math.SQRT1_2);
  });
});

describe('jumpApexHeight', () => {
  it('初速 7.0 m/s・重力 20 m/s² で到達高 1.225 m', () => {
    expect(jumpApexHeight(7, physics)).toBeCloseTo(1.225);
  });
});
