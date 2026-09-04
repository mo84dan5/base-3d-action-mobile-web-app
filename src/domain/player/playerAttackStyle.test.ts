import { describe, expect, it } from 'vitest';
import { vec3 } from '../math/vec3';
import type { PlayerEvent } from './playerEvents';
import { NO_INPUT, cancelCharge, type PlayerStepInput } from './playerStep';
import { DT, Sim, forward, wallBox } from './testHarness';

const gun = (extra: Partial<PlayerStepInput> = {}): PlayerStepInput => ({
  ...NO_INPUT,
  attackStyle: 'gun',
  ...extra,
});
const melee = (extra: Partial<PlayerStepInput> = {}): PlayerStepInput => ({
  ...NO_INPUT,
  attackStyle: 'melee',
  ...extra,
});
const shots = (events: PlayerEvent[]) => events.filter((e) => e.type === 'shotFired');

describe('接近強攻撃(格闘・長押し。F04)', () => {
  it('HoldStart で発動し、スタミナが 25 減り、目標の手前 1.0 m まで 9.0 m/s で踏み込んでから 35 ダメージ・半径 1.5 m の判定が出る', () => {
    const s = new Sim();
    s.step(melee({ attackHoldStart: true, strongTarget: { yaw: 0, distance: 3.0 } }));
    expect(s.player.name).toBe('strongAttack');
    expect(s.player.strong?.phase).toBe('lunge');
    expect(s.player.stamina.value).toBe(75);
    expect(s.has('lungeStarted')).toBe(true);
    s.until((p) => p.strong?.phase === 'swing', melee(), 1);
    expect(s.player.position.z).toBeCloseTo(2.0, 1);
    s.until((p) => p.name !== 'strongAttack', melee(), 2);
    const active = s.events.find((e) => e.type === 'attackActive');
    if (active?.type !== 'attackActive') throw new Error('no active');
    expect(active.kind).toBe('strongAttack');
    expect(active.damage).toBe(35);
    expect(active.radius).toBe(1.5);
    expect(s.player.name).toBe('idle');
    expect(s.player.lastAttackStage).toBe(0);
  });
  it('目標がなければ正面へ 0.35 秒(3.15 m)踏み込む', () => {
    const s = new Sim();
    s.step(melee({ attackHoldStart: true }));
    s.until((p) => p.strong?.phase === 'swing', melee(), 1);
    expect(s.player.position.z).toBeCloseTo(3.15, 1);
  });
  it('スタミナ 0 では発動せず、10 なら発動して 0 になる', () => {
    const s = new Sim();
    s.player = { ...s.player, stamina: { value: 0, regenDelayRemaining: 0 } };
    s.step(melee({ attackHoldStart: true }));
    expect(s.player.name).toBe('idle');
    s.player = { ...s.player, stamina: { value: 10, regenDelayRemaining: 0 } };
    s.step(melee({ attackHoldStart: true }));
    expect(s.player.name).toBe('strongAttack');
    expect(s.player.stamina.value).toBe(0);
  });
  it('通常攻撃中の HoldStart で通常攻撃を打ち切り強攻撃へ移る', () => {
    const s = new Sim();
    s.step(melee({ attack: true }));
    s.run(0.15, melee());
    s.step(melee({ attackHoldStart: true }));
    expect(s.player.name).toBe('strongAttack');
  });
  it('踏み込み中はジャンプ・ダッシュを受け付けず、崖端では落下して中断する', () => {
    const s = new Sim();
    s.step(melee({ attackHoldStart: true }));
    s.step(melee({ jump: true, dash: true }));
    expect(s.player.name).toBe('strongAttack');
    const edge = new Sim([wallBox(-3, 1, { depth: 3.05 })], vec3(0, 1, -0.5), 0);
    edge.step(melee({ attackHoldStart: true }));
    edge.until((p) => p.name !== 'strongAttack', melee(), 2);
    expect(edge.player.name).toBe('fall');
  });
  it('銃撃スタイルでは HoldStart はタメになり強攻撃にならない', () => {
    const s = new Sim();
    s.step(gun({ attackHoldStart: true }));
    expect(s.player.name).toBe('charge');
    expect(s.player.stamina.value).toBe(100);
  });
});

describe('射撃(銃撃・押下。F04)', () => {
  it('押下で射撃になり、発生 0.05 秒で射程 12 m・8 ダメージのヒットスキャンが出て、全体 0.25 秒で Idle に戻る', () => {
    const s = new Sim();
    s.step(gun({ attack: true, shootTarget: { yaw: 0.3 } }));
    expect(s.player.name).toBe('shoot');
    expect(s.player.yaw).toBeCloseTo(0.3);
    let steps = 0;
    while (s.player.name === 'shoot' && steps < 60) {
      s.step(gun());
      steps++;
    }
    expect(steps * DT).toBeCloseTo(0.25, 1);
    const shot = shots(s.events)[0];
    if (shot?.type !== 'shotFired') throw new Error('no shot');
    expect(shot.range).toBe(12);
    expect(shot.damage).toBe(8);
    expect(shot.pierce).toBe(false);
    expect(shot.origin.y).toBeCloseTo(0.85);
    expect(s.player.name).toBe('idle');
  });
  it('射撃中の押下は 1 回だけ保持され連射になる(0.25 秒間隔)', () => {
    const s = new Sim();
    s.step(gun({ attack: true }));
    s.run(0.1, gun({ attack: true }));
    s.run(0.5, gun());
    expect(shots(s.events)).toHaveLength(2);
  });
  it('空中でも射撃でき、回数制限がなく、水平速度を維持する', () => {
    const s = new Sim();
    s.run(0.3, forward(1));
    s.step({ ...forward(1), jump: true });
    s.run(0.1, gun());
    s.step(gun({ attack: true }));
    expect(s.player.name).toBe('shoot');
    expect(Math.hypot(s.player.velocity.x, s.player.velocity.z)).toBeGreaterThan(3);
    s.until((p) => p.name !== 'shoot', gun(), 1);
    s.step(gun({ attack: true }));
    expect(s.player.name).toBe('shoot');
    expect(shots(s.events).length).toBeGreaterThanOrEqual(1);
  });
  it('格闘スタイルの押下は射撃にならない', () => {
    const s = new Sim();
    s.step(melee({ attack: true }));
    expect(s.player.name).toBe('attack');
  });
});

describe('タメ打ち(銃撃・長押し。F04)', () => {
  it('HoldStart でタメが始まり、1.0 秒後の HoldEnd で 60 ダメージ・射程 16 m の貫通射撃が出る', () => {
    const s = new Sim();
    s.step(gun({ attackHoldStart: true }));
    expect(s.player.name).toBe('charge');
    expect(s.has('chargeStarted')).toBe(true);
    s.run(1.0, gun());
    s.step(gun({ attackHoldEnd: true }));
    expect(s.player.name).toBe('chargedShot');
    expect(s.player.chargeRatio).toBeCloseTo(1, 2);
    s.until((p) => p.name !== 'chargedShot', gun(), 1);
    const shot = shots(s.events)[0];
    if (shot?.type !== 'shotFired') throw new Error('no shot');
    expect(shot.kind).toBe('chargedShot');
    expect(shot.damage).toBeCloseTo(60, 0);
    expect(shot.range).toBe(16);
    expect(shot.pierce).toBe(true);
    expect(s.player.name).toBe('idle');
  });
  it('タメ 0.5 秒では 40 ダメージ、タメは 1.0 秒でクランプされる', () => {
    const s = new Sim();
    s.step(gun({ attackHoldStart: true }));
    s.run(0.5, gun());
    s.step(gun({ attackHoldEnd: true }));
    s.until((p) => p.name !== 'chargedShot', gun(), 1);
    const shot = shots(s.events)[0];
    if (shot?.type !== 'shotFired') throw new Error('no shot');
    expect(shot.damage).toBeCloseTo(40, 0);
    const s2 = new Sim();
    s2.step(gun({ attackHoldStart: true }));
    s2.run(2.0, gun());
    s2.step(gun({ attackHoldEnd: true }));
    expect(s2.player.chargeRatio).toBe(1);
  });
  it('タメ中は歩き速度(1.8 m/s)までしか動けず、ジャンプ・ダッシュ・スキルは無効', () => {
    const s = new Sim();
    s.step(gun({ attackHoldStart: true }));
    s.run(0.5, gun({ stick: { x: 0, y: 1, magnitude: 1 } }));
    expect(s.player.name).toBe('charge');
    expect(Math.hypot(s.player.velocity.x, s.player.velocity.z)).toBeCloseTo(1.8, 1);
    s.step(gun({ jump: true, dash: true, skill: true }));
    expect(s.player.name).toBe('charge');
  });
  it('強制解放(cancelCharge)でタメを破棄し、発射しない', () => {
    const s = new Sim();
    s.step(gun({ attackHoldStart: true }));
    s.run(0.5, gun());
    const r = cancelCharge(s.player);
    expect(r.player.name).toBe('idle');
    expect(r.events.some((e) => e.type === 'chargeCancelled')).toBe(true);
    expect(shots(s.events)).toHaveLength(0);
  });
  it('射撃の全体時間内の HoldStart でもタメに入る', () => {
    const s = new Sim();
    s.step(gun({ attack: true }));
    s.run(0.1, gun());
    s.step(gun({ attackHoldStart: true }));
    expect(s.player.name).toBe('charge');
  });
});
