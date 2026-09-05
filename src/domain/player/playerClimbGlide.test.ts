import { describe, expect, it } from 'vitest';
import { resolveHit } from '../combat/damage';
import { vec3 } from '../math/vec3';
import { applyPlayerHit } from './playerHit';
import { NO_INPUT } from './playerStep';
import { DT, Sim, config, forward, stickInput, wallBox } from './testHarness';

const CLIFF = wallBox(3, 6, { width: 8, depth: 10 });

describe('崖登り(F08)', () => {
  it('高さ 6 m の崖に走り込むと自動で取り付き、0.2 秒の取り付き後に登攀できる', () => {
    const s = new Sim([CLIFF]);
    s.until((p) => p.name === 'climb', forward(1), 3);
    expect(s.player.name).toBe('climb');
    expect(s.player.climb?.phase).toBe('attach');
    expect(s.has('climbAttached')).toBe(true);
    expect(s.player.position.z).toBeCloseTo(3 - 0.5, 2);
    expect(s.player.yaw).toBeCloseTo(0, 5);
    s.run(0.25, NO_INPUT);
    expect(s.player.climb?.phase).toBe('climbing');
  });
  it('崖に向かってジャンプすると上昇中でも取り付く', () => {
    const s = new Sim([CLIFF], vec3(0, 0, 1.5));
    s.step({ ...forward(1), jump: true });
    s.until((p) => p.name === 'climb', forward(1), 1);
    expect(s.player.name).toBe('climb');
  });
  it('登攀中に静止してもスタミナは減らず、上へ移動すると毎秒 8 減り 1.0 m/s で登る', () => {
    const s = new Sim([CLIFF]);
    s.until((p) => p.climb?.phase === 'climbing', forward(1), 3);
    const stamina = s.player.stamina.value;
    s.run(1, NO_INPUT);
    expect(s.player.stamina.value).toBe(stamina);
    const y = s.player.position.y;
    s.run(1, stickInput(0, 1));
    expect(s.player.stamina.value).toBeCloseTo(stamina - 8, 0);
    expect(s.player.position.y - y).toBeCloseTo(1.0, 1);
  });
  it('スティック下で 1.2 m/s、左右で 0.8 m/s で面に沿って動く', () => {
    const s = new Sim([CLIFF]);
    s.until((p) => p.climb?.phase === 'climbing', forward(1), 3);
    s.run(2, stickInput(0, 1));
    const y = s.player.position.y;
    s.run(0.5, stickInput(0, -1));
    expect(y - s.player.position.y).toBeCloseTo(0.6, 1);
    const x = s.player.position.x;
    s.run(0.5, stickInput(1, 0));
    expect(Math.abs(s.player.position.x - x)).toBeCloseTo(0.4, 1);
  });
  it('崖ジャンプでスタミナが 15 減り、面に沿って 1.5 m 上へ移動する', () => {
    const s = new Sim([CLIFF]);
    s.until((p) => p.climb?.phase === 'climbing', forward(1), 3);
    const stamina = s.player.stamina.value;
    const y = s.player.position.y;
    s.step({ ...NO_INPUT, jump: true });
    expect(s.player.stamina.value).toBeCloseTo(stamina - 15, 5);
    expect(s.player.climb?.phase).toBe('cliffJump');
    s.until((p) => p.climb?.phase === 'climbing', NO_INPUT, 1);
    expect(s.player.position.y - y).toBeCloseTo(1.5, 1);
    expect(s.has('cliffJumped')).toBe(true);
  });
  it('「離す」(DashPressed)で即時に落下し、面の法線方向に 1.0 m/s の初速を持つ', () => {
    const s = new Sim([CLIFF]);
    s.until((p) => p.climb?.phase === 'climbing', forward(1), 3);
    s.run(1, stickInput(0, 1));
    s.step({ ...NO_INPUT, dash: true });
    expect(s.player.name).toBe('fall');
    expect(s.player.velocity.z).toBeCloseTo(-1.0, 5);
  });
  it('スタミナが 0 になると落下する', () => {
    const s = new Sim([CLIFF]);
    s.until((p) => p.climb?.phase === 'climbing', forward(1), 3);
    s.run(2, stickInput(0, 1));
    s.player = { ...s.player, stamina: { value: 4, regenDelayRemaining: 0 } };
    s.until((p) => p.name !== 'climb', stickInput(0, 1), 1);
    expect(s.player.name).toBe('fall');
    expect(s.player.velocity.z).toBeCloseTo(-0.5, 5);
    expect(s.has('staminaDepleted')).toBe(true);
  });
  it('頂上でよじ登り(0.4 秒)を行い、台地の上で Idle になる', () => {
    const s = new Sim([CLIFF]);
    s.until((p) => p.climb?.phase === 'climbing', forward(1), 3);
    s.until((p) => p.climb?.phase === 'mantle', stickInput(0, 1), 12);
    expect(s.player.climb?.phase).toBe('mantle');
    expect(s.has('mantled')).toBe(true);
    s.until((p) => p.name === 'idle', NO_INPUT, 1);
    expect(s.player.name).toBe('idle');
    expect(s.player.position.y).toBeCloseTo(6, 1);
    expect(s.player.position.z).toBeGreaterThan(3);
  });
  it('登攀中に頭上の天井(オーバーハングの張り出し)へ達すると面を見失って落下し、天井をすり抜けない', () => {
    // 高さ 6 m の壁の前に、高さ 3〜5 m で手前に 2 m 張り出した天井
    const s = new Sim([CLIFF, wallBox(1, 2, { width: 8, depth: 2.5, yBase: 3 })]);
    s.until((p) => p.climb?.phase === 'climbing', forward(1), 3);
    let maxHead = 0;
    for (let i = 0; i < 60 * 6 && s.player.name === 'climb'; i++) {
      s.step(stickInput(0, 1));
      maxHead = Math.max(maxHead, s.player.position.y + 1.7);
    }
    expect(s.player.name).toBe('fall');
    expect(s.events.some((e) => e.type === 'climbDetached' && e.reason === 'lost')).toBe(true);
    expect(maxHead).toBeLessThanOrEqual(3.05);
  });
  it('登攀不可の壁には取り付かない', () => {
    const s = new Sim([wallBox(3, 4, { unclimbable: true })]);
    s.run(2, forward(1));
    expect(s.player.name).not.toBe('climb');
    expect(s.player.position.z).toBeLessThan(3);
  });
  it('高さ 1.0 m の段差には取り付かない', () => {
    const s = new Sim([wallBox(3, 1.0)]);
    s.run(1.5, forward(1));
    expect(s.player.name).not.toBe('climb');
  });
  it('斜度 45 度の滑り面には取り付かない', () => {
    const n = Math.SQRT1_2;
    const s = new Sim([{ kind: 'plane', point: vec3(0, 0, 3), normal: vec3(0, n, -n) }]);
    s.run(2, forward(1));
    expect(s.player.name).not.toBe('climb');
  });
  it('崖の側端を横移動で越えると面を見失い落下する', () => {
    const s = new Sim([wallBox(3, 6, { width: 3, depth: 10 })]);
    s.until((p) => p.climb?.phase === 'climbing', forward(1), 3);
    s.run(1, stickInput(0, 1));
    s.until((p) => p.name === 'fall', stickInput(1, 0), 5);
    expect(s.player.name).toBe('fall');
    expect(s.events.some((e) => e.type === 'climbDetached' && e.reason === 'lost')).toBe(true);
  });
  it('登攀中に被弾すると硬直せず落下する(法線方向 1.0 m/s、無敵 0.5 秒)', () => {
    const s = new Sim([CLIFF]);
    s.until((p) => p.climb?.phase === 'climbing', forward(1), 3);
    s.run(1, stickInput(0, 1));
    const res = resolveHit(
      {
        attackKind: 'enemyAttack',
        attackId: 1,
        attackerId: 1,
        victimId: 'player',
        damage: 15,
        attackerCenter: vec3(0, 0.9, 0),
        victimCenter: vec3(0, 1.85, 2.5),
        victimYaw: s.player.yaw,
        victimCategory: 'climb',
        victimInvincible: false,
      },
      config,
    );
    if (!res) throw new Error('ignored');
    s.player = applyPlayerHit(s.player, res, s.player.climb?.wallNormal ?? null).player;
    for (let i = 0; i < 5; i++) s.step();
    expect(s.player.name).toBe('fall');
    expect(s.player.velocity.z).toBeCloseTo(-1.0, 1);
    expect(s.player.invincibleRemaining).toBeGreaterThan(0.4);
    expect(s.player.stunRemaining).toBe(0);
  });
});

const PLATEAU = wallBox(-10, 10, { width: 10, depth: 10 });

describe('滑空(F08)', () => {
  it('台地から飛び降りて空中でジャンプボタンを押すと滑空し、鉛直速度が 1.5 m/s になる', () => {
    const s = new Sim([PLATEAU], vec3(0, 10, -1), 0);
    s.until((p) => p.name === 'fall', forward(1), 2);
    s.run(0.3, forward(1));
    s.step({ ...forward(1), jump: true });
    expect(s.player.name).toBe('glide');
    s.run(0.3, forward(1));
    expect(s.player.velocity.y).toBeCloseTo(-1.5, 5);
  });
  it('滑空中はスタミナが毎秒 6 減り、水平速度は最大 4.0 m/s', () => {
    const s = new Sim([PLATEAU], vec3(0, 10, -1), 0);
    s.until((p) => p.name === 'fall', forward(1), 2);
    s.run(0.3, forward(1));
    s.step({ ...forward(1), jump: true });
    const stamina = s.player.stamina.value;
    s.run(1, forward(1));
    expect(stamina - s.player.stamina.value).toBeCloseTo(6, 0);
    expect(Math.hypot(s.player.velocity.x, s.player.velocity.z)).toBeCloseTo(4.0, 1);
  });
  it('滑空中に再度ジャンプボタンで解除し、その後もう一度押すと再開できる', () => {
    const s = new Sim([PLATEAU], vec3(0, 10, -1), 0);
    s.until((p) => p.name === 'fall', forward(1), 2);
    s.run(0.3);
    s.step({ ...NO_INPUT, jump: true });
    expect(s.player.name).toBe('glide');
    s.run(0.2);
    s.step({ ...NO_INPUT, jump: true });
    expect(s.player.name).toBe('fall');
    s.run(0.2);
    s.step({ ...NO_INPUT, jump: true });
    expect(s.player.name).toBe('glide');
  });
  it('高度 2 m 未満ではジャンプボタンを押しても滑空しない', () => {
    const s = new Sim([wallBox(-10, 1.8, { width: 10, depth: 10 })], vec3(0, 1.8, -1), 0);
    s.until((p) => p.name === 'fall', forward(1), 2);
    s.run(0.15);
    s.step({ ...NO_INPUT, jump: true });
    expect(s.player.name).toBe('fall');
  });
  it('スタミナ 0 で滑空が強制終了する', () => {
    const s = new Sim([PLATEAU], vec3(0, 10, -1), 0);
    s.until((p) => p.name === 'fall', forward(1), 2);
    s.run(0.3);
    s.player = { ...s.player, stamina: { value: 1, regenDelayRemaining: 0 } };
    s.step({ ...NO_INPUT, jump: true });
    expect(s.player.name).toBe('glide');
    s.run(0.5);
    expect(s.player.name).toBe('fall');
  });
  it('滑空中に崖へ接触すると崖登りに移る', () => {
    const s = new Sim([PLATEAU, wallBox(4, 20, { width: 10, depth: 4 })], vec3(0, 10, -1), 0);
    s.until((p) => p.name === 'fall', forward(1), 2);
    s.run(0.3, forward(1));
    s.step({ ...forward(1), jump: true });
    s.until((p) => p.name === 'climb', forward(1), 5);
    expect(s.player.name).toBe('climb');
    expect(s.events.some((e) => e.type === 'glideEnded' && e.reason === 'climb')).toBe(true);
  });
  it('歩行可能面に着地すると Idle になる', () => {
    const s = new Sim([PLATEAU], vec3(0, 10, -1), 0);
    s.until((p) => p.name === 'fall', forward(1), 2);
    s.run(0.3);
    s.step({ ...NO_INPUT, jump: true });
    s.until((p) => p.name !== 'glide', NO_INPUT, 20);
    expect(s.player.name).toBe('idle');
    expect(s.player.position.y).toBeCloseTo(0, 2);
    expect(s.events.some((e) => e.type === 'glideEnded' && e.reason === 'landed')).toBe(true);
  });
  it('滑空 1 秒での降下は約 1.5 m(参考値: 満タンで約 16.7 秒)', () => {
    const s = new Sim([PLATEAU], vec3(0, 10, -1), 0);
    s.until((p) => p.name === 'fall', forward(1), 2);
    s.run(0.3);
    s.step({ ...NO_INPUT, jump: true });
    s.run(0.3);
    const y = s.player.position.y;
    s.run(1);
    expect(y - s.player.position.y).toBeCloseTo(1.5, 1);
    expect(DT).toBe(1 / 60);
  });
});
