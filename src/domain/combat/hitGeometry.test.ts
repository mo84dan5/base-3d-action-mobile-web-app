import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/gameConfig';
import { vec3 } from '../math/vec3';
import {
  attackSpherePosition,
  capsuleCenter,
  closestPointOnCapsuleToSphere,
  horizontalKnockbackDirection,
  sphereCapsuleOverlap,
  targetCorrectionYaw,
  type Capsule,
} from './hitGeometry';

const config = defaultConfig.combat;
const enemyCapsule = (x: number, z: number): Capsule => ({
  feet: vec3(x, 0, z),
  radius: 0.5,
  height: 1.8,
});

describe('カプセル(F04 敵 半径 0.5 m・高さ 1.8 m)', () => {
  it('中心は足元 + 0.9 m', () => {
    expect(capsuleCenter(enemyCapsule(0, 0)).y).toBeCloseTo(0.9);
  });
});

describe('球対カプセルの重なり(F04 正面 1.0 m・半径 1.2 m)', () => {
  it('プレイヤー正面 2.5 m の敵にヒットする(1.0 + 1.2 + 0.5 = 2.7 m 以内)', () => {
    const sphere = attackSpherePosition(vec3(0, 0, 0), 0, config.hitSphereForward);
    expect(sphereCapsuleOverlap(sphere, config.hitSphereRadius, enemyCapsule(0, 2.5))).toBe(true);
  });
  it('正面 2.8 m の敵にはヒットしない', () => {
    const sphere = attackSpherePosition(vec3(0, 0, 0), 0, config.hitSphereForward);
    expect(sphereCapsuleOverlap(sphere, config.hitSphereRadius, enemyCapsule(0, 2.8))).toBe(false);
  });
  it('背後 1.0 m の敵にはヒットしない', () => {
    const sphere = attackSpherePosition(vec3(0, 0, 0), 0, config.hitSphereForward);
    expect(sphereCapsuleOverlap(sphere, config.hitSphereRadius, enemyCapsule(0, -1.0))).toBe(false);
  });
  it('高さ 5 m 上の敵にはヒットしない(球は高さ 0.85 m)', () => {
    const sphere = attackSpherePosition(vec3(0, 0, 0), 0, config.hitSphereForward);
    const high: Capsule = { feet: vec3(0, 5, 1), radius: 0.5, height: 1.8 };
    expect(sphereCapsuleOverlap(sphere, config.hitSphereRadius, high)).toBe(false);
  });
  it('最近接点はカプセル表面上(中心軸から半径 0.5 m)にある', () => {
    const p = closestPointOnCapsuleToSphere(vec3(3, 0.9, 0), enemyCapsule(0, 0));
    expect(p.x).toBeCloseTo(0.5);
    expect(p.y).toBeCloseTo(0.9);
  });
});

describe('攻撃球の位置', () => {
  it('ヨー 0(+z)で正面 1.0 m・高さ 0.85 m', () => {
    const p = attackSpherePosition(vec3(1, 0, 1), 0, 1.0);
    expect(p).toEqual({ x: 1, y: 0.85, z: 2 });
  });
});

describe('ターゲット補正(F04 正面 ±30 度・3.0 m)', () => {
  it('正面 20 度・2 m の敵の方向へ向く', () => {
    const yaw = targetCorrectionYaw(
      vec3(0, 0, 0),
      0,
      [{ id: 1, feet: vec3(2 * Math.sin(0.35), 0, 2 * Math.cos(0.35)), hp: 60 }],
      config,
    );
    expect(yaw).toBeCloseTo(0.35);
  });
  it('正面 45 度の敵は対象外', () => {
    const yaw = targetCorrectionYaw(
      vec3(0, 0, 0),
      0,
      [{ id: 1, feet: vec3(Math.sin(0.8), 0, Math.cos(0.8)), hp: 60 }],
      config,
    );
    expect(yaw).toBeNull();
  });
  it('3.5 m 先の敵は対象外、HP 0 の敵は対象外', () => {
    expect(
      targetCorrectionYaw(vec3(0, 0, 0), 0, [{ id: 1, feet: vec3(0, 0, 3.5), hp: 60 }], config),
    ).toBeNull();
    expect(
      targetCorrectionYaw(vec3(0, 0, 0), 0, [{ id: 1, feet: vec3(0, 0, 2), hp: 0 }], config),
    ).toBeNull();
  });
  it('複数いれば最も近い敵を選ぶ', () => {
    const yaw = targetCorrectionYaw(
      vec3(0, 0, 0),
      0,
      [
        { id: 1, feet: vec3(0.3, 0, 2.9), hp: 60 },
        { id: 2, feet: vec3(-0.3, 0, 1.5), hp: 60 },
      ],
      config,
    );
    expect(yaw).toBeCloseTo(Math.atan2(-0.3, 1.5));
  });
});

describe('ノックバック方向(F10 処理 7)', () => {
  it('攻撃側から被弾側へ離れる水平単位ベクトル', () => {
    const d = horizontalKnockbackDirection(vec3(0, 0.85, 0), vec3(0, 0.9, 2), 0);
    expect(d).toEqual({ x: 0, y: 0, z: 1 });
  });
  it('中心が一致すれば被弾側の背面方向', () => {
    const d = horizontalKnockbackDirection(vec3(0, 0, 0), vec3(0, 0, 0), 0);
    expect(d.z).toBeCloseTo(-1);
  });
});
