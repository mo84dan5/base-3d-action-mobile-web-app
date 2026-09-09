import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { StyleCategory } from '../../domain/attackStyle/actionSpec';
import {
  armSwingAngle,
  buildCharacterParts,
  CharacterAnimator,
  headNodAngle,
  legSwing,
  meshCount,
  type PlayerPose,
} from './characterParts';

const DEG = Math.PI / 180;
const CATEGORIES: StyleCategory[] = [
  'sword',
  'strike',
  'polearm',
  'firearm',
  'ranged',
  'magic',
  'placement',
  'defense',
  'movement',
  'special',
];

const pose = (extra: Partial<PlayerPose> = {}): PlayerPose => ({
  motion: null,
  speed: 0,
  grounded: true,
  dashing: false,
  equipment: { head: 'firearm', rightArm: 'sword', leftArm: 'magic' },
  flashOpacity: 0,
  ...extra,
});

describe('パーツ分けキャラクター(デザインディレクション キャラクター)', () => {
  it('胴・頭・両腕・両脚の支点があり、右腕はプレイヤーの右(−X)にある', () => {
    const parts = buildCharacterParts();
    expect(parts.pivots.head.position.y).toBeCloseTo(1.32);
    expect(parts.pivots.rightArm.position.x).toBeCloseTo(-0.34);
    expect(parts.pivots.leftArm.position.x).toBeCloseTo(0.34);
    expect(parts.pivots.rightLeg.position.y).toBeCloseTo(0.67);
    expect(parts.root.getObjectByName('torso')).toBeInstanceOf(THREE.Mesh);
  });
  it('どの系統の組み合わせでもメッシュは 15 以内で、付属物は装備を変えた瞬間に差し替わる', () => {
    const parts = buildCharacterParts();
    const anim = new CharacterAnimator(parts);
    for (const c of CATEGORIES) {
      anim.update(pose({ equipment: { head: c, rightArm: c, leftArm: c } }), 1 / 60);
      expect(meshCount(parts)).toBeLessThanOrEqual(15);
      expect(parts.attachments.head.children.length).toBeGreaterThan(0);
      expect(parts.attachments.rightArm.children.length).toBeGreaterThan(0);
    }
    anim.update(
      pose({ equipment: { head: 'sword', rightArm: 'sword', leftArm: 'sword' } }),
      1 / 60,
    );
    const before = parts.attachments.rightArm.children[0];
    anim.update(
      pose({ equipment: { head: 'sword', rightArm: 'sword', leftArm: 'sword' } }),
      1 / 60,
    );
    expect(parts.attachments.rightArm.children[0]).toBe(before);
    anim.update(
      pose({ equipment: { head: 'sword', rightArm: 'ranged', leftArm: 'sword' } }),
      1 / 60,
    );
    expect(parts.attachments.rightArm.children[0]).not.toBe(before);
  });
});

describe('技のモーション', () => {
  it('腕(押下): progress 0.35 で −95 度、1.0 で 0 度', () => {
    expect(armSwingAngle(0, false)).toBeCloseTo(0);
    expect(armSwingAngle(0.35, false)).toBeCloseTo(-95 * DEG);
    expect(armSwingAngle(1, false)).toBeCloseTo(0);
    expect(armSwingAngle(0.1, false)).toBeLessThan(0);
  });
  it('腕(長押し): 0.2 から 0.85 まで −80 度を保持', () => {
    expect(armSwingAngle(0.2, true)).toBeCloseTo(-80 * DEG);
    expect(armSwingAngle(0.5, true)).toBeCloseTo(-80 * DEG);
    expect(armSwingAngle(1, true)).toBeCloseTo(0);
  });
  it('頭: 押下は 0.3 で 22 度、長押しは 15 度を保持', () => {
    expect(headNodAngle(0.3, false)).toBeCloseTo(22 * DEG);
    expect(headNodAngle(1, false)).toBeCloseTo(0);
    expect(headNodAngle(0.5, true)).toBeCloseTo(15 * DEG);
  });
  it('実行中のスロットのパーツだけが回り、終わると 0.1 秒で戻る', () => {
    const anim = new CharacterAnimator(buildCharacterParts());
    anim.update(pose({ motion: { part: 'leftArm', progress: 0.35, hold: false } }), 1 / 60);
    expect(anim.angle('leftArm')).toBeCloseTo(-95 * DEG);
    expect(anim.angle('rightArm')).toBe(0);
    expect(anim.angle('head')).toBe(0);
    anim.update(pose(), 0.05);
    expect(anim.angle('leftArm')).toBeLessThan(0);
    anim.update(pose(), 0.05);
    expect(anim.angle('leftArm')).toBeCloseTo(0, 6);
  });
  it('頭の長押しでは付属物が明滅する(emissive が 0 でない)', () => {
    const parts = buildCharacterParts();
    const anim = new CharacterAnimator(parts);
    anim.update(pose({ motion: { part: 'head', progress: 0.5, hold: true } }), 0.1);
    const mesh = parts.attachments.head.children[0];
    if (!(mesh instanceof THREE.Mesh) || !(mesh.material instanceof THREE.MeshLambertMaterial)) {
      throw new Error('unreachable');
    }
    expect(
      mesh.material.emissive.r + mesh.material.emissive.g + mesh.material.emissive.b,
    ).toBeGreaterThan(0);
  });
});

describe('歩行の脚', () => {
  it('歩き(≤ 1.8 m/s)は ±22 度 1.5 Hz、走りは ±35 度 2.5 Hz、ダッシュは 3 Hz', () => {
    expect(legSwing(1.0, true, false)).toEqual({ amplitudeDeg: 22, hz: 1.5 });
    expect(legSwing(1.8, true, false)).toEqual({ amplitudeDeg: 22, hz: 1.5 });
    expect(legSwing(4.0, true, false)).toEqual({ amplitudeDeg: 35, hz: 2.5 });
    expect(legSwing(9.0, true, true)).toEqual({ amplitudeDeg: 35, hz: 3.0 });
  });
  it('空中・停止では振らず、脚は逆位相で振れる', () => {
    expect(legSwing(3, false, false)).toBeNull();
    expect(legSwing(0, true, false)).toBeNull();
    const anim = new CharacterAnimator(buildCharacterParts());
    anim.update(pose({ speed: 1 }), 1 / 6); // 1.5 Hz の 1/4 周期
    expect(anim.angle('rightLeg')).toBeCloseTo(22 * DEG, 3);
    expect(anim.angle('leftLeg')).toBeCloseTo(-22 * DEG, 3);
    anim.update(pose({ speed: 0 }), 0.15);
    expect(anim.angle('rightLeg')).toBe(0);
  });
});
