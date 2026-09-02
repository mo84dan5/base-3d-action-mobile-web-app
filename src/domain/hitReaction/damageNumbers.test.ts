import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/gameConfig';
import {
  damageNumberVisual,
  spawnDamageNumber,
  tickDamageNumbers,
  type DamageNumber,
} from './damageNumbers';

const config = defaultConfig.hitReaction;
const anchor = { x: 1, y: 2, z: 3 };

describe('ダメージ数値の種別(F10)', () => {
  it('プレイヤーの攻撃 10 は通常、30 は大ダメージ、プレイヤー被弾は被ダメージ', () => {
    const a = spawnDamageNumber(
      [],
      { targetId: 1, amount: 10, isPlayerAttack: true, anchor },
      config,
      1,
    );
    const b = spawnDamageNumber(
      [],
      { targetId: 1, amount: 30, isPlayerAttack: true, anchor },
      config,
      1,
    );
    const c = spawnDamageNumber(
      [],
      { targetId: 'player', amount: 15, isPlayerAttack: false, anchor },
      config,
      1,
    );
    expect(a[0]?.kind).toBe('normal');
    expect(b[0]?.kind).toBe('big');
    expect(c[0]?.kind).toBe('playerHit');
  });
});

describe('ダメージ数値のずらしと上限(F10)', () => {
  it('同一対象への 3 連続ヒットは 0.3 m ずつ上にずれる', () => {
    let list: readonly DamageNumber[] = [];
    for (let i = 0; i < 3; i++) {
      list = spawnDamageNumber(
        list,
        { targetId: 1, amount: 10, isPlayerAttack: true, anchor },
        config,
        i,
      );
    }
    expect(list.map((n) => n.stackIndex)).toEqual([0, 1, 2]);
    expect(list[2]?.worldPosition.y).toBeCloseTo(2 + 0.6);
  });
  it('4 個目を出すと最古が即時消え、3 個のまま', () => {
    let list: readonly DamageNumber[] = [];
    for (let i = 0; i < 3; i++) {
      list = spawnDamageNumber(
        list,
        { targetId: 1, amount: 10, isPlayerAttack: true, anchor },
        config,
        i,
      );
      list = tickDamageNumbers(list, 0.1, config);
    }
    list = spawnDamageNumber(
      list,
      { targetId: 1, amount: 10, isPlayerAttack: true, anchor },
      config,
      99,
    );
    expect(list).toHaveLength(3);
    expect(list.some((n) => n.id === 0)).toBe(false);
    expect(list.some((n) => n.id === 99)).toBe(true);
  });
  it('別の対象へのヒットはずらさない', () => {
    let list = spawnDamageNumber(
      [],
      { targetId: 1, amount: 10, isPlayerAttack: true, anchor },
      config,
      1,
    );
    list = spawnDamageNumber(
      list,
      { targetId: 2, amount: 10, isPlayerAttack: true, anchor },
      config,
      2,
    );
    expect(list[1]?.stackIndex).toBe(0);
  });
});

describe('ダメージ数値の寿命と見た目(S02 要素 12)', () => {
  it('0.8 秒で消える', () => {
    const list = spawnDamageNumber(
      [],
      { targetId: 1, amount: 10, isPlayerAttack: true, anchor },
      config,
      1,
    );
    expect(tickDamageNumbers(list, 0.79, config)).toHaveLength(1);
    expect(tickDamageNumbers(list, 0.8, config)).toHaveLength(0);
  });
  it('出現 2 ステップ後に不透明 1、最後の 0.3 秒でフェードし、上昇量は 0.6 m に近づく', () => {
    const base = spawnDamageNumber(
      [],
      { targetId: 1, amount: 10, isPlayerAttack: true, anchor },
      config,
      1,
    )[0];
    if (base === undefined) throw new Error('spawn failed');
    expect(damageNumberVisual({ ...base, age: 0 }, config).opacity).toBe(0);
    expect(damageNumberVisual({ ...base, age: 2 / 60 }, config).opacity).toBeCloseTo(1);
    expect(damageNumberVisual({ ...base, age: 0.65 }, config).opacity).toBeCloseTo(0.5);
    expect(damageNumberVisual({ ...base, age: 0.8 }, config).riseMeters).toBeCloseTo(0.6);
    expect(damageNumberVisual({ ...base, age: 0.4 }, config).color).toBe('white');
  });
  it('大ダメージは黄・1.4 倍で、出現時に 1.2 倍からポップする', () => {
    const big = spawnDamageNumber(
      [],
      { targetId: 1, amount: 80, isPlayerAttack: true, anchor },
      config,
      1,
    )[0];
    if (big === undefined) throw new Error('spawn failed');
    expect(damageNumberVisual({ ...big, age: 0 }, config).scale).toBeCloseTo(1.4 * 1.2);
    expect(damageNumberVisual({ ...big, age: 0.1 }, config).scale).toBeCloseTo(1.4);
    expect(damageNumberVisual(big, config).color).toBe('yellow');
  });
  it('被ダメージは赤', () => {
    const n = spawnDamageNumber(
      [],
      { targetId: 'player', amount: 15, isPlayerAttack: false, anchor },
      config,
      1,
    )[0];
    if (n === undefined) throw new Error('spawn failed');
    expect(damageNumberVisual(n, config).color).toBe('red');
  });
});
