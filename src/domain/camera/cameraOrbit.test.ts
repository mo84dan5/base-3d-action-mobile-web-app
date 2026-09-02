import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/gameConfig';
import { defaultSettings } from '../settings/settings';
import {
  applyLook,
  applyZoom,
  blendTowards,
  cameraPositionFor,
  createCameraOrbit,
  decayInertia,
  followTarget,
  groundLimitedDistance,
  obstacleDistance,
  pinchDeltaToZoom,
  pitchLimitsFor,
  recoverDistance,
  shouldHidePlayer,
  startInertia,
  wheelToZoom,
} from './cameraOrbit';

const config = defaultConfig.camera;
const orbit = createCameraOrbit(0, config);
const rad = (deg: number) => (deg * Math.PI) / 180;

describe('createCameraOrbit(F02 パラメータ)', () => {
  it('距離 4.5 m・ピッチ 15 度・プレイヤー正面の後方', () => {
    expect(orbit).toEqual({ yaw: 0, pitchDeg: 15, distance: 4.5 });
  });
});

describe('applyLook(F02 操作)', () => {
  it('感度 1.0 では 1 px で 0.25 度回る(F02)', () => {
    const next = applyLook(orbit, 0, 4, defaultSettings, config);
    expect(next.pitchDeg).toBeCloseTo(16);
  });
  it('感度 2.0 では 1 px で 0.5 度回る', () => {
    const next = applyLook(orbit, 0, 2, { ...defaultSettings, cameraSensitivity: 2.0 }, config);
    expect(next.pitchDeg).toBeCloseTo(16);
  });
  it('右ドラッグ(dx > 0)で yaw が減る(視点が右を向く)', () => {
    const next = applyLook(orbit, 40, 0, defaultSettings, config);
    expect(next.yaw).toBeCloseTo(-rad(10));
  });
  it('上ドラッグ(dy < 0)でピッチが減る(見上げる)', () => {
    const next = applyLook(orbit, 0, -40, defaultSettings, config);
    expect(next.pitchDeg).toBeCloseTo(5);
  });
  it('左右反転で yaw の向きが逆になる', () => {
    const next = applyLook(orbit, 40, 0, { ...defaultSettings, invertCameraX: true }, config);
    expect(next.yaw).toBeCloseTo(rad(10));
  });
  it('上下反転でピッチの向きが逆になる', () => {
    const next = applyLook(orbit, 0, -40, { ...defaultSettings, invertCameraY: true }, config);
    expect(next.pitchDeg).toBeCloseTo(25);
  });
  it('ピッチは −30〜+70 度に制限される', () => {
    expect(applyLook(orbit, 0, -1000, defaultSettings, config).pitchDeg).toBe(-30);
    expect(applyLook(orbit, 0, 1000, defaultSettings, config).pitchDeg).toBe(70);
  });
  it('崖登り中はピッチ下限が −50 度に広がり、上限 70 度は変わらない', () => {
    const limits = pitchLimitsFor('climb', config);
    expect(limits).toEqual({ minDeg: -50, maxDeg: 70 });
    expect(applyLook(orbit, 0, -1000, defaultSettings, config, limits).pitchDeg).toBe(-50);
  });
  it('ヨーは制限なし(360 度以上回せる)', () => {
    const next = applyLook(orbit, 2000, 0, defaultSettings, config);
    expect(next.yaw).toBeCloseTo(-rad(500));
  });
});

describe('applyZoom / pinchDeltaToZoom / wheelToZoom(F02)', () => {
  it('距離は 2.0〜8.0 m にクランプされる', () => {
    expect(applyZoom(orbit, 10, config).distance).toBe(8);
    expect(applyZoom(orbit, -10, config).distance).toBe(2);
    expect(applyZoom(orbit, 1, config).distance).toBe(5.5);
  });
  it('指間距離が 100 px 広がると 1.0 m 近づく', () => {
    expect(pinchDeltaToZoom(100, config)).toBe(-1);
    expect(pinchDeltaToZoom(-50, config)).toBe(0.5);
  });
  it('ホイール 1 ノッチで 0.5 m', () => {
    expect(wheelToZoom(1, config)).toBe(0.5);
    expect(wheelToZoom(-2, config)).toBe(-1);
  });
});

describe('cameraPositionFor(F02 カメラ位置)', () => {
  it('ピッチ 0・yaw 0 では注視点の −z 側 4.5 m', () => {
    const pos = cameraPositionFor({ x: 0, y: 1.4, z: 0 }, { yaw: 0, pitchDeg: 0, distance: 4.5 });
    expect(pos.x).toBeCloseTo(0);
    expect(pos.y).toBeCloseTo(1.4);
    expect(pos.z).toBeCloseTo(-4.5);
  });
  it('ピッチ 90 度では真上', () => {
    const pos = cameraPositionFor({ x: 0, y: 0, z: 0 }, { yaw: 0, pitchDeg: 90, distance: 4.5 });
    expect(pos.y).toBeCloseTo(4.5);
    expect(pos.z).toBeCloseTo(0);
  });
  it('滑空中の加算距離 +1.0 m が反映される', () => {
    const pos = cameraPositionFor({ x: 0, y: 0, z: 0 }, { yaw: 0, pitchDeg: 0, distance: 4.5 }, 1);
    expect(pos.z).toBeCloseTo(-5.5);
  });
});

describe('慣性(F02 ドラッグ終了後 0.15 秒で減衰)', () => {
  it('LookEnd 時点の速度から始まり 0.15 秒で 0 になる', () => {
    let inertia = startInertia(10, 0, 1 / 60, config);
    expect(inertia.remaining).toBe(0.15);
    let total = 0;
    for (let i = 0; i < 20; i++) {
      const r = decayInertia(inertia, 1 / 60, config);
      inertia = r.inertia;
      total += r.dx;
    }
    expect(inertia.remaining).toBe(0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(10 * 60 * 0.15);
  });
  it('慣性なしのとき移動量は 0', () => {
    const r = decayInertia({ vx: 0, vy: 0, remaining: 0 }, 1 / 60, config);
    expect(r.dx).toBe(0);
  });
});

describe('followTarget(F02 追従 時定数 0.08 秒)', () => {
  it('0.08 秒で差の約 63% を詰める', () => {
    const next = followTarget({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0.08, config);
    expect(next.x).toBeCloseTo(1 - Math.exp(-1));
  });
});

describe('障害物との干渉回避(F02)', () => {
  it('当たった点の手前 0.2 m に配置する', () => {
    expect(obstacleDistance(4.5, 3.0, config)).toBeCloseTo(2.8);
  });
  it('当たらなければ希望距離のまま', () => {
    expect(obstacleDistance(4.5, null, config)).toBe(4.5);
  });
  it('平地でピッチ −30 度にすると距離は約 2.6 m に縮む', () => {
    expect(groundLimitedDistance(1.4, -30, config)).toBeCloseTo(2.6);
  });
  it('接近は即時、復帰は 0.3 秒かけて補間する', () => {
    expect(recoverDistance(4.5, 2.8, 1 / 60, config)).toBe(2.8);
    const recovered = recoverDistance(2.8, 4.5, 1 / 60, config);
    expect(recovered).toBeGreaterThan(2.8);
    expect(recovered).toBeLessThan(4.5);
  });
  it('1.0 m 以内でプレイヤーを非表示にする', () => {
    expect(shouldHidePlayer(0.99, config)).toBe(true);
    expect(shouldHidePlayer(1.0, config)).toBe(false);
  });
});

describe('blendTowards(F02 状態遷移の 0.3 秒補間)', () => {
  it('崖登りを抜けた −45 度が 0.3 秒で −30 度へ戻る', () => {
    let pitch = -45;
    for (let i = 0; i < 18; i++)
      pitch = blendTowards(pitch, -30, 1 / 60, config.stateTransitionTime, 15);
    expect(pitch).toBeCloseTo(-30, 3);
  });
  it('半分の時間では途中の値', () => {
    const pitch = blendTowards(-45, -30, 0.15, config.stateTransitionTime);
    expect(pitch).toBeCloseTo(-37.5, 3);
  });
});
