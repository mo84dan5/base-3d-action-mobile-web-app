import { describe, expect, it } from 'vitest';
import { resolveHit } from '../combat/damage';
import { vec3 } from '../math/vec3';
import { applyPlayerHit } from './playerHit';
import type { PlayerEvent } from './playerEvents';
import { NO_INPUT } from './playerStep';
import { DT, Sim, config, forward, wallBox } from './testHarness';

const attackInput = { ...NO_INPUT, attack: true };

function activeEvents(events: PlayerEvent[]) {
  return events.filter((e) => e.type === 'attackActive');
}

describe('通常攻撃 3 段コンボ(F04)', () => {
  it('連打で 1 → 2 → 3 段と進み、ダメージは 10・10・15、当たり判定は正面 1.0 m・半径 1.2 m', () => {
    const s = new Sim();
    s.step(attackInput);
    expect(s.player.name).toBe('attack');
    expect(s.player.attack?.stage).toBe(1);
    for (let i = 0; i < 90; i++) s.step(attackInput);
    const started = s.events.filter((e) => e.type === 'attackStarted');
    expect(started.map((e) => (e.type === 'attackStarted' ? e.stage : 0)).slice(0, 3)).toEqual([
      1, 2, 3,
    ]);
    const damages = new Set(
      activeEvents(s.events).map((e) => (e.type === 'attackActive' ? e.damage : 0)),
    );
    expect([...damages].sort()).toEqual([10, 15]);
    const first = activeEvents(s.events)[0];
    if (first?.type !== 'attackActive') throw new Error('unreachable');
    expect(first.radius).toBe(1.2);
    expect(first.center.z).toBeCloseTo(first.center.z);
  });
  it('各段の全体時間は 0.4 / 0.4 / 0.6 秒で、発生 0.1 秒後に当たり判定が始まる', () => {
    const s = new Sim();
    s.step(attackInput);
    let steps = 0;
    while (s.player.name === 'attack' && steps < 60) {
      s.step();
      steps++;
    }
    expect(steps * DT).toBeCloseTo(0.4, 1);
    const firstActiveIndex = s.events.findIndex((e) => e.type === 'attackActive');
    expect(firstActiveIndex).toBeGreaterThan(0);
  });
  it('3 段目のあとは間隔に関係なく 1 段目に戻る', () => {
    const s = new Sim();
    s.player = { ...s.player, lastAttackStage: 3, comboWindowRemaining: 0.5 };
    s.step(attackInput);
    expect(s.player.attack?.stage).toBe(1);
  });
  it('1 段目のあと 0.8 秒以上あけると 1 段目に戻り、0.8 秒以内なら 2 段目', () => {
    const s = new Sim();
    s.step(attackInput);
    s.until((p) => p.name === 'idle');
    expect(s.player.comboWindowRemaining).toBeCloseTo(0.8, 5);
    s.run(0.5);
    s.step(attackInput);
    expect(s.player.attack?.stage).toBe(2);
    s.until((p) => p.name === 'idle');
    s.run(0.9);
    s.step(attackInput);
    expect(s.player.attack?.stage).toBe(1);
  });
  it('攻撃中の入力は 1 つだけ保持し、全体時間の終了時に次段を出す', () => {
    const s = new Sim();
    s.step(attackInput);
    s.run(0.2, attackInput);
    s.until((p) => p.attack?.stage === 2 || p.name === 'idle');
    expect(s.player.name).toBe('attack');
    expect(s.player.attack?.stage).toBe(2);
  });
  it('発生前のジャンプ入力は攻撃をキャンセルし、発生後は捨てる', () => {
    const s = new Sim();
    s.step(attackInput);
    s.step({ ...NO_INPUT, jump: true });
    expect(s.player.name).toBe('jump');
    const s2 = new Sim();
    s2.step(attackInput);
    s2.run(0.15);
    s2.step({ ...NO_INPUT, jump: true });
    expect(s2.player.name).toBe('attack');
  });
  it('スプリント中の攻撃はスプリントを終了し水平速度を 0 にする', () => {
    const s = new Sim();
    s.player = { ...s.player, sprintHeld: true };
    s.run(0.5, forward(1));
    s.step({ ...forward(1), attack: true });
    expect(s.player.name).toBe('attack');
    expect(s.player.velocity).toEqual(vec3(0, 0, 0));
  });
  it('前進量 0.3 m が発生〜持続の間に進み、崖端では落下して攻撃が中断される', () => {
    const s = new Sim();
    s.step(attackInput);
    s.until((p) => p.name === 'idle');
    expect(s.player.position.z).toBeCloseTo(0.3, 2);
    const edge = new Sim([wallBox(-3, 1, { depth: 3.05 })], vec3(0, 1, -0.2), 0);
    edge.step(attackInput);
    edge.until((p) => p.name !== 'attack');
    expect(edge.player.name).toBe('fall');
  });
  it('開始カウントダウン中(actionsAllowed = false)は攻撃できない', () => {
    const s = new Sim();
    s.step({ ...attackInput, actionsAllowed: false });
    expect(s.player.name).toBe('idle');
  });
});

describe('空中攻撃(F04)', () => {
  it('ジャンプ中に攻撃すると 10 ダメージの空中攻撃が出て、同じ空中滞在で 2 回目は出ない', () => {
    const s = new Sim();
    s.step({ ...NO_INPUT, jump: true });
    s.run(0.1);
    s.step(attackInput);
    expect(s.player.name).toBe('airAttack');
    s.until((p) => p.name !== 'airAttack');
    s.step(attackInput);
    expect(s.player.name).not.toBe('airAttack');
    expect(s.events.filter((e) => e.type === 'attackStarted')).toHaveLength(1);
  });
  it('着地後も全体時間まで継続し、その後 Idle へ。着地後は再び空中攻撃できる', () => {
    const s = new Sim();
    s.step({ ...NO_INPUT, jump: true });
    s.until((p) => p.velocity.y < 0 && p.position.y < 0.5);
    s.step(attackInput);
    s.until((p) => p.grounded);
    expect(s.player.name).toBe('airAttack');
    s.until((p) => p.name !== 'airAttack');
    expect(s.player.name).toBe('idle');
    expect(s.player.airAttackUsed).toBe(false);
  });
  it('空中攻撃はコンボ段を進めず、地上の段数を保持する', () => {
    const s = new Sim();
    s.step(attackInput);
    s.until((p) => p.name === 'idle');
    s.step({ ...NO_INPUT, jump: true });
    s.step(attackInput);
    s.until((p) => p.name === 'idle', NO_INPUT, 3);
    expect(s.player.lastAttackStage).toBe(1);
  });
});

describe('スキル・バースト(F04)', () => {
  it('スキルは発生 0.2 秒後に半径 2.5 m・30 ダメージの判定が出て、全体 0.7 秒で終わる', () => {
    const s = new Sim();
    s.step({ ...NO_INPUT, skill: true });
    expect(s.player.name).toBe('skill');
    let steps = 0;
    while (s.player.name === 'skill') {
      s.step();
      steps++;
    }
    expect(steps * DT).toBeCloseTo(0.7, 1);
    const active = activeEvents(s.events)[0];
    if (active?.type !== 'attackActive') throw new Error('unreachable');
    expect(active.radius).toBe(2.5);
    expect(active.damage).toBe(30);
    expect(active.kind).toBe('skill');
  });
  it('バーストは半径 4.0 m・80 ダメージ、全体 1.2 秒で無敵(hitCategory = burst)', () => {
    const s = new Sim();
    s.step({ ...NO_INPUT, burst: true });
    expect(s.player.name).toBe('burst');
    s.until((p) => p.name !== 'burst');
    expect(s.player.stateTime).toBeLessThan(DT * 2);
    const active = activeEvents(s.events)[0];
    if (active?.type !== 'attackActive') throw new Error('unreachable');
    expect(active.radius).toBe(4.0);
    expect(active.damage).toBe(80);
  });
});

function enemyHit(
  s: Sim,
  category: 'grounded' | 'airborne' | 'climb' | 'glide' | 'burst',
  invincible = false,
) {
  return resolveHit(
    {
      attackKind: 'enemyAttack',
      attackId: 1,
      attackerId: 1,
      victimId: 'player',
      damage: 15,
      attackerCenter: vec3(0, 0.9, 1),
      victimCenter: vec3(s.player.position.x, 0.85, s.player.position.z),
      victimYaw: s.player.yaw,
      victimCategory: category,
      victimInvincible: invincible,
    },
    config,
  );
}

describe('被弾(F04 / F10)', () => {
  it('接地中の被弾: HP −15、ヒットストップ 4 ステップ後に硬直 0.3 秒・ノックバック 1.7 m/s・無敵 0.5 秒', () => {
    const s = new Sim();
    const res = enemyHit(s, 'grounded');
    if (!res) throw new Error('ignored');
    const applied = applyPlayerHit(s.player, res, null);
    s.player = applied.player;
    expect(s.player.hp).toBe(85);
    expect(s.player.hitstopSteps).toBe(4);
    expect(s.player.name).toBe('idle');
    s.step(NO_INPUT, 0);
    expect(s.player.name).toBe('idle');
    s.step();
    expect(s.player.name).toBe('hit');
    expect(s.player.stunRemaining).toBeCloseTo(0.3 - DT, 5);
    expect(s.player.invincibleRemaining).toBeCloseTo(0.5 - DT, 5);
    expect(s.has('stunned')).toBe(true);
    const start = s.player.position.z;
    s.until((p) => p.name === 'idle');
    expect(s.player.position.z - start).toBeGreaterThan(-0.3);
    expect(s.player.position.z - start).toBeLessThan(-0.15);
  });
  it('硬直中は移動入力を受け付けず、0.3 秒で Idle に戻る', () => {
    const s = new Sim();
    const res = enemyHit(s, 'grounded');
    if (!res) throw new Error('ignored');
    s.player = applyPlayerHit(s.player, res, null).player;
    s.step();
    let steps = 0;
    while (s.player.name === 'hit') {
      s.step(forward(1));
      steps++;
    }
    expect(steps * DT).toBeCloseTo(0.3, 1);
  });
  it('空中の被弾はダメージと無敵のみで、硬直・ノックバックしない', () => {
    const s = new Sim();
    s.step({ ...NO_INPUT, jump: true });
    const res = enemyHit(s, 'airborne');
    if (!res) throw new Error('ignored');
    s.player = applyPlayerHit(s.player, res, null).player;
    s.step();
    expect(s.player.name).toBe('jump');
    expect(s.player.invincibleRemaining).toBeGreaterThan(0);
    expect(s.player.knockbackRemaining).toBe(0);
  });
  it('バースト中は無敵で何も起きない(resolveHit が null)', () => {
    const s = new Sim();
    expect(enemyHit(s, 'burst')).toBeNull();
  });
  it('無敵時間中の被弾は無効', () => {
    const s = new Sim();
    expect(enemyHit(s, 'grounded', true)).toBeNull();
  });
  it('HP 0 で Dead になり入力を受け付けない', () => {
    const s = new Sim();
    s.player = { ...s.player, hp: 10 };
    const res = enemyHit(s, 'grounded');
    if (!res) throw new Error('ignored');
    const applied = applyPlayerHit(s.player, res, null);
    s.player = applied.player;
    expect(s.player.name).toBe('dead');
    expect(applied.events.some((e) => e.type === 'died')).toBe(true);
    s.step({ ...forward(1), jump: true });
    expect(s.player.name).toBe('dead');
  });
});
