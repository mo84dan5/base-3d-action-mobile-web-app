import { describe, expect, it } from 'vitest';
import {
  DEMO_SECONDS,
  PREVIEW_CAMERA,
  PREVIEW_SPIN,
  advanceDemo,
  demoPose,
  previewCameraPosition,
} from './characterPreview';

describe('組み替えプレビュー(キャラクター.md 組み替えプレビュー)', () => {
  it('カメラは注視点 (0, 0.9, 0) から距離 3.4 m、右前 35 度(−X 側)・仰角 10 度', () => {
    const p = previewCameraPosition();
    const t = PREVIEW_CAMERA.target;
    const d = Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z);
    expect(d).toBeCloseTo(3.4);
    expect(p.x).toBeLessThan(0);
    expect(p.z).toBeGreaterThan(0);
    expect(p.y).toBeGreaterThan(t.y);
    expect(Math.atan2(-p.x, p.z)).toBeCloseTo((35 * Math.PI) / 180);
    expect(PREVIEW_CAMERA.fov).toBe(30);
  });
  it('自転は 0.35 rad/s(3 Hz 未満・20 秒弱で 1 周)', () => {
    expect(PREVIEW_SPIN).toBe(0.35);
    expect((Math.PI * 2) / PREVIEW_SPIN).toBeLessThan(20);
  });
  it('技のデモ: 選んだスロットの押下モーションを 0.6 秒で 1 回再生し、終わると待機に戻る', () => {
    expect(demoPose(null)).toEqual({ motion: null, speed: 0 });
    const half = demoPose({ slot: 'leftArm', elapsed: 0.3 });
    expect(half.motion).toEqual({ part: 'leftArm', progress: 0.5, hold: false });
    expect(half.speed).toBe(0);
    expect(demoPose({ slot: 'head', elapsed: DEMO_SECONDS.technique }).motion).toBeNull();
    expect(advanceDemo({ slot: 'head', elapsed: 0.5 }, 0.05)).toEqual({
      slot: 'head',
      elapsed: 0.55,
    });
    expect(advanceDemo({ slot: 'head', elapsed: 0.58 }, 0.05)).toBeNull();
    expect(advanceDemo(null, 0.1)).toBeNull();
  });
  it('脚のデモ: 1.5 秒の歩き(≤ 1.8 m/s)で、モーションは無し', () => {
    const walk = demoPose({ slot: 'legs', elapsed: 1.0 });
    expect(walk.motion).toBeNull();
    expect(walk.speed).toBeGreaterThan(0);
    expect(walk.speed).toBeLessThanOrEqual(1.8);
    expect(demoPose({ slot: 'legs', elapsed: DEMO_SECONDS.walk }).speed).toBe(0);
    expect(advanceDemo({ slot: 'legs', elapsed: 1.49 }, 0.02)).toBeNull();
  });
});
