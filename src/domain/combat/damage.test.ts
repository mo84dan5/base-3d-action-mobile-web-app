import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/gameConfig';
import { vec3 } from '../math/vec3';
import { hpAfterDamage, isBigDamage, resolveHit, type HitRequest } from './damage';

const base: HitRequest = {
  attackKind: 'normal1',
  attackId: 1,
  attackerId: 'player',
  victimId: 7,
  damage: 10,
  attackerCenter: vec3(0, 0.85, 0),
  victimCenter: vec3(0, 0.9, 2),
  victimYaw: Math.PI,
  victimCategory: 'enemyPatrol',
  victimInvincible: false,
  enemyStunAvailable: true,
};

describe('HP 減算(F04)', () => {
  it('HP 60 に 80 ダメージで 0(負にならない)', () => {
    expect(hpAfterDamage(60, 80)).toBe(0);
    expect(hpAfterDamage(60, 10)).toBe(50);
  });
  it('30 以上が大ダメージ', () => {
    expect(isBigDamage(30, defaultConfig)).toBe(true);
    expect(isBigDamage(15, defaultConfig)).toBe(false);
  });
});

describe('無効判定(F10 処理 2)', () => {
  it('無敵中の被弾は null(フィードバックなし)', () => {
    expect(resolveHit({ ...base, victimInvincible: true }, defaultConfig)).toBeNull();
  });
  it('バースト中・取り付き/よじ登り中・死亡中のプレイヤーは null', () => {
    const enemyAttack: HitRequest = {
      ...base,
      attackKind: 'enemyAttack',
      attackerId: 7,
      victimId: 'player',
    };
    expect(resolveHit({ ...enemyAttack, victimCategory: 'burst' }, defaultConfig)).toBeNull();
    expect(
      resolveHit({ ...enemyAttack, victimCategory: 'invulnerableAnim' }, defaultConfig),
    ).toBeNull();
    expect(resolveHit({ ...enemyAttack, victimCategory: 'dead' }, defaultConfig)).toBeNull();
  });
});

describe('徘徊型への通常攻撃 1 段(F04 / F10)', () => {
  const r = resolveHit(base, defaultConfig);
  it('ダメージ 10、ヒットストップ 3/3、白フラッシュ、エネルギー +5、シェイクなし', () => {
    expect(r?.damage).toBe(10);
    expect(r?.hitstop).toEqual({ attacker: 3, victim: 3 });
    expect(r?.flash).toBe('white');
    expect(r?.energyGain).toBe(5);
    expect(r?.shake).toBeNull();
    expect(r?.vibrationMs).toBe(0);
  });
  it('硬直 0.3 秒、ノックバック 1.7 m/s を攻撃側から離れる方向へ', () => {
    expect(r?.applyStun).toBe(true);
    expect(r?.stunSeconds).toBe(0.3);
    expect(r?.knockback?.z).toBeCloseTo(1.7);
    expect(r?.knockbackDecay).toBe(0.3);
  });
  it('硬直の 1 秒制限中は硬直しないがダメージ・ノックバックは入る', () => {
    const limited = resolveHit({ ...base, enemyStunAvailable: false }, defaultConfig);
    expect(limited?.applyStun).toBe(false);
    expect(limited?.damage).toBe(10);
    expect(limited?.knockback).not.toBeNull();
  });
});

describe('スキル・バースト・空中攻撃のヒット', () => {
  it('スキル: ノックバック 5.0 m/s、エネルギー +15、シェイク 0.08 m', () => {
    const r = resolveHit({ ...base, attackKind: 'skill', damage: 30 }, defaultConfig);
    expect(r?.knockback?.z).toBeCloseTo(5.0);
    expect(r?.energyGain).toBe(15);
    expect(r?.shake).toEqual({ amplitude: 0.08, steps: 9 });
    expect(r?.hitstop).toEqual({ attacker: 4, victim: 4 });
  });
  it('バースト: ノックバックなし、エネルギー加算なし、ヒットストップ 8', () => {
    const r = resolveHit({ ...base, attackKind: 'burst', damage: 80 }, defaultConfig);
    expect(r?.knockback).toBeNull();
    expect(r?.energyGain).toBe(0);
    expect(r?.hitstop).toEqual({ attacker: 8, victim: 8 });
  });
  it('空中攻撃: エネルギー +5、シェイク 0.03 m', () => {
    const r = resolveHit({ ...base, attackKind: 'airAttack' }, defaultConfig);
    expect(r?.energyGain).toBe(5);
    expect(r?.shake).toEqual({ amplitude: 0.03, steps: 5 });
  });
});

describe('訓練用ダミーへのヒット(F04)', () => {
  it('硬直・ノックバックなし。ヒットストップ・フラッシュは掛かる', () => {
    const r = resolveHit(
      { ...base, victimCategory: 'enemyDummy', attackKind: 'normal3' },
      defaultConfig,
    );
    expect(r?.applyStun).toBe(false);
    expect(r?.knockback).toBeNull();
    expect(r?.hitstop).toEqual({ attacker: 5, victim: 5 });
    expect(r?.flash).toBe('white');
  });
});

describe('プレイヤーの状態別の被弾処理(F04)', () => {
  const enemyAttack: HitRequest = {
    ...base,
    attackKind: 'enemyAttack',
    attackerId: 7,
    victimId: 'player',
    damage: 15,
    attackerCenter: vec3(0, 0.9, 2),
    victimCenter: vec3(0, 0.85, 0),
    victimYaw: 0,
  };
  it('接地中: 硬直 0.3 秒、ノックバック 1.7 m/s、無敵 0.5 秒、Hit 状態へ、赤フラッシュ、振動 20 ms', () => {
    const r = resolveHit({ ...enemyAttack, victimCategory: 'grounded' }, defaultConfig);
    expect(r?.applyStun).toBe(true);
    expect(r?.stunSeconds).toBe(0.3);
    expect(r?.knockback?.z).toBeCloseTo(-1.7);
    expect(r?.invincibleSeconds).toBe(0.5);
    expect(r?.stateTransition).toBe('hitState');
    expect(r?.flash).toBe('red');
    expect(r?.vibrationMs).toBe(20);
    expect(r?.hitstop).toEqual({ attacker: 3, victim: 4 });
    expect(r?.shake).toEqual({ amplitude: 0.1, steps: 12 });
    expect(r?.energyGain).toBe(0);
  });
  it('空中: ダメージと無敵のみ。硬直・ノックバックなし', () => {
    const r = resolveHit({ ...enemyAttack, victimCategory: 'airborne' }, defaultConfig);
    expect(r?.damage).toBe(15);
    expect(r?.applyStun).toBe(false);
    expect(r?.knockback).toBeNull();
    expect(r?.invincibleSeconds).toBe(0.5);
    expect(r?.stateTransition).toBe('none');
  });
  it('崖登り中: 硬直なし、Fall へ、法線方向 1.0 m/s、無敵 0.5 秒', () => {
    const r = resolveHit({ ...enemyAttack, victimCategory: 'climb' }, defaultConfig);
    expect(r?.applyStun).toBe(false);
    expect(r?.stateTransition).toBe('toFall');
    expect(r?.detachSpeed).toBe(1.0);
    expect(r?.invincibleSeconds).toBe(0.5);
  });
  it('滑空中: 滑空を解除して Fall へ、無敵 0.5 秒', () => {
    const r = resolveHit({ ...enemyAttack, victimCategory: 'glide' }, defaultConfig);
    expect(r?.stateTransition).toBe('toFall');
    expect(r?.detachSpeed).toBe(0);
    expect(r?.invincibleSeconds).toBe(0.5);
  });
});
