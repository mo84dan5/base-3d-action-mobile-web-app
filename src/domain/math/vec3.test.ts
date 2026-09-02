import { describe, expect, it } from 'vitest';
import {
  directionFromYaw,
  removeComponentAlong,
  rotateTowards,
  vec3,
  wrapAngle,
  yawFromDirection,
} from './vec3';

describe('directionFromYaw / yawFromDirection', () => {
  it('ヨー 0 は +z、ヨー π/2 は +x', () => {
    expect(directionFromYaw(0).z).toBeCloseTo(1);
    expect(directionFromYaw(Math.PI / 2).x).toBeCloseTo(1);
  });
  it('往復で元の角度に戻る', () => {
    expect(yawFromDirection(directionFromYaw(0.7))).toBeCloseTo(0.7);
  });
});

describe('rotateTowards', () => {
  it('差が最大回転量以下なら目標角そのもの', () => {
    expect(rotateTowards(0, 0.1, 0.2)).toBe(0.1);
  });
  it('最短方向へ最大回転量だけ回る(π を跨ぐ)', () => {
    expect(rotateTowards(3.0, -3.0, 0.1)).toBeCloseTo(3.1);
  });
});

describe('wrapAngle', () => {
  it('[−π, π] に収める', () => {
    expect(wrapAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI * 0.5);
  });
});

describe('removeComponentAlong(壁ずり)', () => {
  it('壁の法線方向の速度成分を除去する', () => {
    const v = removeComponentAlong(vec3(1, 0, 1), vec3(1, 0, 0));
    expect(v.x).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(1);
  });
});
