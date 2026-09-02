import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/gameConfig';
import { rectContains } from '../math/vec2';
import {
  computeInputRegions,
  detectOrientation,
  fixedStickCenter,
  fovFor,
  isOrientationChange,
  viewOffsetFor,
} from './orientation';

describe('detectOrientation(F09 向きの定義)', () => {
  it('844×390 は横画面', () => {
    expect(detectOrientation(844, 390)).toBe('landscape');
  });
  it('390×844 は縦画面', () => {
    expect(detectOrientation(390, 844)).toBe('portrait');
  });
  it('正方形 500×500 は縦画面', () => {
    expect(detectOrientation(500, 500)).toBe('portrait');
  });
});

describe('isOrientationChange(F09 向きが変わらない寸法変化)', () => {
  it('844×390 → 390×844 は向きの切替', () => {
    expect(isOrientationChange({ width: 844, height: 390 }, { width: 390, height: 844 })).toBe(
      true,
    );
  });
  it('390×844 → 390×760(アドレスバー表示)は向きの切替ではない', () => {
    expect(isOrientationChange({ width: 390, height: 844 }, { width: 390, height: 760 })).toBe(
      false,
    );
  });
  it('844×390 → 844×400 は向きの切替ではない', () => {
    expect(isOrientationChange({ width: 844, height: 390 }, { width: 844, height: 400 })).toBe(
      false,
    );
  });
});

describe('computeInputRegions(F09 入力領域)', () => {
  it('横画面 844×390: スティックは左半分、カメラは右半分', () => {
    const regions = computeInputRegions(844, 390, 'landscape');
    expect(regions.stick).toEqual({ x: 0, y: 0, width: 422, height: 390 });
    expect(regions.camera).toEqual({ x: 422, y: 0, width: 422, height: 390 });
    expect(rectContains(regions.stick, { x: 100, y: 300 })).toBe(true);
    expect(rectContains(regions.camera, { x: 100, y: 300 })).toBe(false);
    expect(rectContains(regions.camera, { x: 700, y: 50 })).toBe(true);
  });
  it('縦画面 390×844: カメラは上半分の全幅、スティックは下半分の左半分', () => {
    const regions = computeInputRegions(390, 844, 'portrait');
    expect(regions.camera).toEqual({ x: 0, y: 0, width: 390, height: 422 });
    expect(regions.stick).toEqual({ x: 0, y: 422, width: 195, height: 422 });
    expect(regions.buttons).toEqual({ x: 195, y: 422, width: 195, height: 422 });
  });
  it('縦画面の下半分の右(ボタン群の隙間)はスティック領域にもカメラ領域にも含まれない', () => {
    const regions = computeInputRegions(390, 844, 'portrait');
    const point = { x: 300, y: 600 };
    expect(rectContains(regions.stick, point)).toBe(false);
    expect(rectContains(regions.camera, point)).toBe(false);
  });
  it('中心線ちょうどの点は右側 / 下側の領域に属する', () => {
    const regions = computeInputRegions(844, 390, 'landscape');
    expect(rectContains(regions.stick, { x: 422, y: 10 })).toBe(false);
    expect(rectContains(regions.camera, { x: 422, y: 10 })).toBe(true);
  });
});

describe('fixedStickCenter(F09 固定スティック位置)', () => {
  it('横画面 844×390 では x 25%・y 70% = (211, 273)', () => {
    expect(fixedStickCenter(844, 390, 'landscape', defaultConfig.stick)).toEqual({
      x: 211,
      y: 273,
    });
  });
  it('縦画面 390×844 では x 25%・y 80% = (97.5, 675.2)', () => {
    const center = fixedStickCenter(390, 844, 'portrait', defaultConfig.stick);
    expect(center.x).toBeCloseTo(97.5);
    expect(center.y).toBeCloseTo(675.2);
  });
});

describe('viewOffsetFor(F09 注視点の投影位置)', () => {
  it('横画面 844×390 ではオフセット 0(注視点は中央 50%)', () => {
    expect(viewOffsetFor(844, 390, 'landscape', defaultConfig.camera)).toEqual({
      fullWidth: 844,
      fullHeight: 390,
      x: 0,
      y: 0,
      width: 844,
      height: 390,
    });
  });
  it('縦画面 390×844 では y = 844 × (0.5 − 0.35) = 126.6(注視点が上から 35%)', () => {
    const offset = viewOffsetFor(390, 844, 'portrait', defaultConfig.camera);
    expect(offset.y).toBeCloseTo(126.6);
    expect(offset.x).toBe(0);
    expect(offset.width).toBe(390);
    expect(offset.height).toBe(844);
  });
});

describe('fovFor(F09 視野角)', () => {
  it('横画面 50 度 / 縦画面 70 度', () => {
    expect(fovFor('landscape', defaultConfig.camera)).toBe(50);
    expect(fovFor('portrait', defaultConfig.camera)).toBe(70);
  });
});
