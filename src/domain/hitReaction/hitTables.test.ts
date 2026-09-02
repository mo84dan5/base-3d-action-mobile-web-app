import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/gameConfig';
import { hitstopFor, shakeForEvent, shakeForHit } from './hitTables';

const config = defaultConfig.hitReaction;

describe('ヒットストップの長さ(F10)', () => {
  it('通常攻撃 1・2 段は 3 ステップ、3 段は 5 ステップ', () => {
    expect(hitstopFor('normal1', config)).toEqual({ attacker: 3, victim: 3 });
    expect(hitstopFor('normal2', config)).toEqual({ attacker: 3, victim: 3 });
    expect(hitstopFor('normal3', config)).toEqual({ attacker: 5, victim: 5 });
  });
  it('スキル 4、バースト 8、敵の攻撃は攻撃側 3 / 被弾側 4', () => {
    expect(hitstopFor('skill', config)).toEqual({ attacker: 4, victim: 4 });
    expect(hitstopFor('burst', config)).toEqual({ attacker: 8, victim: 8 });
    expect(hitstopFor('enemyAttack', config)).toEqual({ attacker: 3, victim: 4 });
  });
});

describe('カメラシェイクの選択(F10)', () => {
  it('通常攻撃 1・2 段のヒットはシェイクなし', () => {
    expect(shakeForHit('normal1', config)).toBeNull();
    expect(shakeForHit('normal2', config)).toBeNull();
  });
  it('3 段ヒットは 0.05 m・7 ステップ、スキルは 0.08 m・9 ステップ', () => {
    expect(shakeForHit('normal3', config)).toEqual({ amplitude: 0.05, steps: 7 });
    expect(shakeForHit('skill', config)).toEqual({ amplitude: 0.08, steps: 9 });
  });
  it('バーストは発動時に 0.15 m・18 ステップ(ヒット時ではない)', () => {
    expect(shakeForHit('burst', config)).toBeNull();
    expect(shakeForEvent('burstActivate', config)).toEqual({ amplitude: 0.15, steps: 18 });
  });
  it('プレイヤー被弾 0.10 m・12、敵撃破 0.06 m・9、敗北 0.15 m・18、着地 0.04 m・6', () => {
    expect(shakeForEvent('playerHit', config)).toEqual({ amplitude: 0.1, steps: 12 });
    expect(shakeForEvent('enemyDefeat', config)).toEqual({ amplitude: 0.06, steps: 9 });
    expect(shakeForEvent('playerDefeat', config)).toEqual({ amplitude: 0.15, steps: 18 });
    expect(shakeForEvent('landing', config)).toEqual({ amplitude: 0.04, steps: 6 });
  });
});
