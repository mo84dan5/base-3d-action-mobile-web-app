import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/gameConfig';
import { vec3 } from '../math/vec3';
import { hitstopForChargedShot, shakeForChargedShot } from '../hitReaction/hitTables';
import { resolveHit } from './damage';
import { nearestTargetInCone, rayCapsuleDistance } from './hitGeometry';

const config = defaultConfig;
const enemyCapsule = (x: number, z: number) => ({ feet: vec3(x, 0, z), radius: 0.5, height: 1.8 });

describe('レイ対カプセル(F04 射撃のヒットスキャン)', () => {
  it('正面 5 m の敵に当たり、交差距離はカプセル手前(約 4.5 m)', () => {
    const t = rayCapsuleDistance(vec3(0, 0.85, 0), vec3(0, 0, 1), 12, enemyCapsule(0, 5));
    expect(t).not.toBeNull();
    expect(t ?? 0).toBeCloseTo(4.5, 1);
  });
  it('射程 12 m の外(13 m)には当たらない', () => {
    expect(rayCapsuleDistance(vec3(0, 0.85, 0), vec3(0, 0, 1), 12, enemyCapsule(0, 13))).toBeNull();
  });
  it('射線から 1 m 横にずれた敵には当たらない(半径 0.5 m)', () => {
    expect(rayCapsuleDistance(vec3(0, 0.85, 0), vec3(0, 0, 1), 12, enemyCapsule(1, 5))).toBeNull();
  });
  it('射線から 0.4 m 横の敵には当たる', () => {
    expect(
      rayCapsuleDistance(vec3(0, 0.85, 0), vec3(0, 0, 1), 12, enemyCapsule(0.4, 5)),
    ).not.toBeNull();
  });
});

describe('円錐内の最近接目標(接近強攻撃 ±45 度・6 m / 射撃 ±15 度・12 m)', () => {
  const enemies = [
    { id: 1, feet: vec3(2, 0, 4), hp: 60 },
    { id: 2, feet: vec3(0, 0, 8), hp: 60 },
    { id: 3, feet: vec3(0, 0, 3), hp: 0 },
  ];
  it('±45 度・6 m では斜め前の敵 1(距離 4.5 m)が選ばれ、HP 0 の敵 3 は無視される', () => {
    const t = nearestTargetInCone(vec3(0, 0, 0), 0, enemies, 45, 6);
    expect(t?.id).toBe(1);
    expect(t?.distance).toBeCloseTo(Math.hypot(2, 4), 3);
  });
  it('±15 度・12 m では正面の敵 2(8 m)だけが候補', () => {
    expect(nearestTargetInCone(vec3(0, 0, 0), 0, enemies, 15, 12)?.id).toBe(2);
  });
  it('範囲外なら null', () => {
    expect(nearestTargetInCone(vec3(0, 0, 0), 0, enemies, 15, 5)).toBeNull();
  });
});

describe('タメ打ちのヒットストップとシェイク(F10)', () => {
  it('タメ 0.5 未満は 4 ステップ、0.5 以上は 6 ステップ', () => {
    expect(hitstopForChargedShot(0.3, config.hitReaction).attacker).toBe(4);
    expect(hitstopForChargedShot(0.5, config.hitReaction).attacker).toBe(6);
  });
  it('シェイクは 0.04 + 0.08 × タメ率(最大 0.12 m・12 ステップ)', () => {
    expect(shakeForChargedShot(0, config.hitReaction)).toEqual({ amplitude: 0.04, steps: 9 });
    expect(shakeForChargedShot(1, config.hitReaction).amplitude).toBeCloseTo(0.12, 5);
    expect(shakeForChargedShot(1, config.hitReaction).steps).toBe(12);
  });
  it('resolveHit: 接近強攻撃はノックバック 5.0・エネルギー +10、射撃は 1.0・+3、タメ打ちは 3.0・+10 でシェイクなし', () => {
    const base = {
      attackId: 1,
      attackerId: 'player' as const,
      victimId: 1,
      attackerCenter: vec3(0, 0.85, 0),
      victimCenter: vec3(0, 0.9, 2),
      victimYaw: 0,
      victimCategory: 'enemyPatrol' as const,
      victimInvincible: false,
      enemyStunAvailable: true,
    };
    const strong = resolveHit({ ...base, attackKind: 'strongAttack', damage: 35 }, config);
    expect(strong?.knockback?.z).toBeCloseTo(5.0);
    expect(strong?.energyGain).toBe(10);
    expect(strong?.hitstop.attacker).toBe(6);
    const shoot = resolveHit({ ...base, attackKind: 'shoot', damage: 8 }, config);
    expect(shoot?.knockback?.z).toBeCloseTo(1.0);
    expect(shoot?.energyGain).toBe(3);
    expect(shoot?.shake).toBeNull();
    const charged = resolveHit(
      { ...base, attackKind: 'chargedShot', damage: 60, chargeRatio: 1 },
      config,
    );
    expect(charged?.knockback?.z).toBeCloseTo(3.0);
    expect(charged?.energyGain).toBe(10);
    expect(charged?.hitstop.victim).toBe(6);
    expect(charged?.shake).toBeNull();
  });
});
