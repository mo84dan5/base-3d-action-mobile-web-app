import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../domain/config/gameConfig';
import { VfxPlayer, slashOrientation } from './vfxPlayer';

// 斬撃の板が「振りの軌跡の面」に置かれることを検証する(デザインディレクション エフェクト「斬撃」)。
const normalOf = (q: THREE.Quaternion) => new THREE.Vector3(0, 0, 1).applyQuaternion(q);
const arcCenterOf = (q: THREE.Quaternion) => new THREE.Vector3(1, 0, 0).applyQuaternion(q);

describe('slashOrientation', () => {
  it('水平斬り(roll 0)は板の法線が上を向き、弧の中心が前方(yaw 0 = +z)を向く', () => {
    const q = slashOrientation(0, 0);
    const n = normalOf(q);
    expect(n.y).toBeCloseTo(1, 5);
    const c = arcCenterOf(q);
    expect(c.z).toBeCloseTo(1, 5);
  });
  it('縦斬り(roll 90 度)は板が前方を含む鉛直面になる(法線が水平で前方に直交)', () => {
    const q = slashOrientation(0, Math.PI / 2);
    const n = normalOf(q);
    expect(Math.abs(n.y)).toBeLessThan(1e-5);
    expect(Math.abs(n.z)).toBeLessThan(1e-5);
    expect(arcCenterOf(q).z).toBeCloseTo(1, 5);
  });
  it('斜め斬り(roll 45 度)は法線が 45 度傾く', () => {
    const n = normalOf(slashOrientation(0, Math.PI / 4));
    expect(n.y).toBeCloseTo(Math.SQRT1_2, 5);
  });
  it('yaw π/2 では弧の中心が +x を向き、水平斬りの法線は上のまま', () => {
    const q = slashOrientation(Math.PI / 2, 0);
    expect(arcCenterOf(q).x).toBeCloseTo(1, 5);
    expect(normalOf(q).y).toBeCloseTo(1, 5);
  });
});

describe('VfxPlayer の斬撃', () => {
  it('攻撃の振りで斬撃メッシュがプレイヤー中心の高さに置かれ、正面を向く板にならない', () => {
    const vfx = new VfxPlayer(defaultConfig, 'medium', new THREE.CapsuleGeometry(0.4, 0.9));
    vfx.trigger({ kind: 'attackSwing', attack: 'normal3', position: { x: 2, y: 0, z: 3 }, yaw: 0 });
    const mesh = vfx.group.getObjectByName('vfx_normal3_slash_1.6') as THREE.Mesh | undefined;
    expect(mesh).toBeDefined();
    if (!mesh) return;
    expect(mesh.visible).toBe(true);
    expect(mesh.position.y).toBeCloseTo(0.85, 5);
    expect(mesh.position.z).toBeCloseTo(3, 5);
    expect(normalOf(mesh.quaternion).y).toBeCloseTo(1, 5);
  });
});
