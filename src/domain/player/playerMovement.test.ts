import { describe, expect, it } from 'vitest';
import { horizontalLength, vec3 } from '../math/vec3';
import { NO_INPUT } from './playerStep';
import { DT, Sim, config, forward, stickInput, wallBox } from './testHarness';

describe('移動(F01)', () => {
  it('スティック 0.5 は歩き(1.8 m/s)、1.0 は走り(4.5 m/s)に加速度 30 m/s² で到達する', () => {
    const s = new Sim();
    s.run(0.5, forward(0.5));
    expect(s.player.name).toBe('walk');
    expect(horizontalLength(s.player.velocity)).toBeCloseTo(1.8);
    s.run(0.5, forward(1));
    expect(s.player.name).toBe('run');
    expect(horizontalLength(s.player.velocity)).toBeCloseTo(4.5);
  });
  it('移動方向はカメラのヨー基準(カメラ前方 = スティック上)', () => {
    const s = new Sim();
    s.run(0.5, { ...forward(1), cameraYaw: Math.PI / 2 });
    expect(s.player.velocity.x).toBeCloseTo(4.5);
    expect(Math.abs(s.player.velocity.z)).toBeLessThan(1e-6);
  });
  it('入力 0 で Idle に戻り、速度は減速で 0 になる', () => {
    const s = new Sim();
    s.run(0.5, forward(1));
    s.run(0.5, NO_INPUT);
    expect(s.player.name).toBe('idle');
    expect(horizontalLength(s.player.velocity)).toBe(0);
  });
});

describe('ダッシュ・スプリント(F01)', () => {
  it('スプリント押下で即時 9.0 m/s のダッシュになり、スタミナが 18 減り、0.25 秒で約 2.25 m 進む', () => {
    const s = new Sim();
    const start = s.player.position;
    s.step({ ...forward(1), dash: true });
    expect(s.player.name).toBe('dash');
    expect(horizontalLength(s.player.velocity)).toBe(9);
    expect(s.player.stamina.value).toBe(82);
    expect(s.has('dashStarted')).toBe(true);
    s.until((p) => p.name !== 'dash', forward(1));
    expect(s.player.position.z - start.z).toBeCloseTo(2.25, 1);
  });
  it('入力なしのダッシュは正面へ進み、終了後 Idle に戻る', () => {
    const s = new Sim([], vec3(0, 0, 0), 0);
    s.step({ ...NO_INPUT, dash: true });
    s.until((p) => p.name !== 'dash');
    expect(s.player.name).toBe('idle');
    expect(s.player.position.z).toBeGreaterThan(2);
  });
  it('長押し(200 ms で SprintHoldStart)でダッシュ後にスプリントへ移行し、スタミナが毎秒 15 減る', () => {
    const s = new Sim();
    s.step({ ...forward(1), dash: true });
    s.run(0.2, forward(1));
    s.step({ ...forward(1), sprintHoldStart: true });
    s.until((p) => p.name !== 'dash', forward(1));
    expect(s.player.name).toBe('sprint');
    const before = s.player.stamina.value;
    s.run(1, forward(1));
    expect(before - s.player.stamina.value).toBeCloseTo(15, 0);
    expect(horizontalLength(s.player.velocity)).toBeCloseTo(6.5);
  });
  it('スタミナ 0 でスプリントが終わり走りに戻る', () => {
    const s = new Sim();
    s.player = { ...s.player, stamina: { value: 5, regenDelayRemaining: 0 }, sprintHeld: true };
    s.run(0.1, forward(1));
    expect(s.player.name).toBe('sprint');
    s.run(0.5, forward(1));
    expect(s.player.name).toBe('run');
    expect(s.player.stamina.value).toBe(0);
    expect(s.has('staminaDepleted')).toBe(true);
  });
  it('スプリント中にスティックを離して戻すと、ボタンを押し直さずにスプリントが再開する', () => {
    const s = new Sim();
    s.player = { ...s.player, sprintHeld: true };
    s.run(0.3, forward(1));
    expect(s.player.name).toBe('sprint');
    s.run(0.3, NO_INPUT);
    expect(s.player.name).toBe('idle');
    s.run(0.1, forward(1));
    expect(s.player.name).toBe('sprint');
  });
  it('スタミナが 18 未満でも 0 より大きければダッシュでき、残量が 0 になる', () => {
    const s = new Sim();
    s.player = { ...s.player, stamina: { value: 10, regenDelayRemaining: 0 } };
    s.step({ ...forward(1), dash: true });
    expect(s.player.name).toBe('dash');
    expect(s.player.stamina.value).toBe(0);
  });
  it('スタミナ 0 ではダッシュできない', () => {
    const s = new Sim();
    s.player = { ...s.player, stamina: { value: 0, regenDelayRemaining: 0 } };
    s.step({ ...forward(1), dash: true });
    expect(s.player.name).not.toBe('dash');
  });
  it('スタミナは消費停止 1 秒後から毎秒 25 回復する', () => {
    const s = new Sim();
    s.player = { ...s.player, stamina: { value: 50, regenDelayRemaining: 0 } };
    s.step({ ...forward(1), dash: true });
    s.until((p) => p.name !== 'dash', forward(1));
    const afterDash = s.player.stamina.value;
    s.run(0.9, NO_INPUT);
    expect(s.player.stamina.value).toBeCloseTo(afterDash, 5);
    s.run(1.1, NO_INPUT);
    expect(s.player.stamina.value).toBeGreaterThan(afterDash + 20);
  });
});

describe('ジャンプ(F01)', () => {
  it('接地中のジャンプで初速 7.0 m/s、到達高約 1.225 m、約 0.7 秒で着地する', () => {
    const s = new Sim();
    s.step({ ...NO_INPUT, jump: true });
    expect(s.player.name).toBe('jump');
    expect(s.player.velocity.y).toBe(7);
    let apex = 0;
    let steps = 0;
    while (s.player.name !== 'idle' && steps < 120) {
      s.step();
      apex = Math.max(apex, s.player.position.y);
      steps++;
    }
    expect(apex).toBeCloseTo(1.225, 1);
    expect(steps * DT).toBeCloseTo(0.7, 1);
    expect(s.has('landed')).toBe(true);
  });
  it('空中では二段ジャンプしない', () => {
    const s = new Sim();
    s.step({ ...NO_INPUT, jump: true });
    s.run(0.2);
    const vy = s.player.velocity.y;
    s.step({ ...NO_INPUT, jump: true });
    expect(s.player.velocity.y).toBeLessThan(vy);
    expect(s.count('jumped')).toBe(1);
  });
  it('平地からのジャンプでは滑空できない(到達高 1.225 m < 2.0 m)', () => {
    const s = new Sim();
    s.step({ ...NO_INPUT, jump: true });
    for (let i = 0; i < 40; i++) s.step({ ...NO_INPUT, jump: true });
    expect(s.has('glideStarted')).toBe(false);
  });
  it('スプリントジャンプは水平速度を維持し、着地時にボタンを押し続けていればスプリントに戻る', () => {
    const s = new Sim();
    s.player = { ...s.player, sprintHeld: true };
    s.run(0.5, forward(1));
    expect(s.player.name).toBe('sprint');
    s.step({ ...forward(1), jump: true });
    const stamina = s.player.stamina.value;
    s.run(0.3, forward(1));
    expect(horizontalLength(s.player.velocity)).toBeCloseTo(6.5);
    expect(s.player.stamina.value).toBeCloseTo(stamina, 5);
    s.until((p) => p.name !== 'jump' && p.name !== 'fall', forward(1));
    expect(s.player.name).toBe('sprint');
  });
  it('段差の縁から走り出て 0.1 秒以内のジャンプ入力が成立する(コヨーテタイム)', () => {
    const s = new Sim([wallBox(-3, 1.0, { depth: 3 })], vec3(0, 1.0, -1.5), 0);
    s.until((p) => p.name === 'fall', forward(1));
    expect(s.player.name).toBe('fall');
    s.run(0.05, forward(1));
    s.step({ ...forward(1), jump: true });
    expect(s.player.name).toBe('jump');
  });
  it('接地喪失から 0.1 秒を超えたジャンプ入力は成立しない', () => {
    const s = new Sim([wallBox(-3, 1.0, { depth: 3 })], vec3(0, 1.0, -1.5), 0);
    s.until((p) => p.name === 'fall', forward(1));
    s.run(0.15, forward(1));
    s.step({ ...forward(1), jump: true });
    expect(s.player.name).toBe('fall');
  });
  it('着地の 0.1 秒前までのジャンプ入力は着地時に実行される(入力バッファ)', () => {
    const s = new Sim();
    s.step({ ...NO_INPUT, jump: true });
    s.until((p) => p.position.y < 0.3 && p.velocity.y < 0);
    s.step({ ...NO_INPUT, jump: true });
    s.until((p) => p.name === 'jump' && p.stateTime < DT * 2, NO_INPUT, 0.2);
    expect(s.count('jumped')).toBe(2);
  });
});

describe('地形との相互作用(F05)', () => {
  it('高さ 0.3 m の段差は歩いて乗れる', () => {
    const s = new Sim([wallBox(2, 0.3)]);
    s.run(1.5, forward(1));
    expect(s.player.position.y).toBeCloseTo(0.3, 2);
    expect(s.player.position.z).toBeGreaterThan(2.5);
  });
  it('高さ 0.5 m の段差は歩いては乗れない', () => {
    const s = new Sim([wallBox(2, 0.5)]);
    s.run(1.5, forward(1));
    expect(s.player.position.y).toBeCloseTo(0, 2);
    expect(s.player.position.z).toBeLessThan(2);
  });
  it('高さ 1.0 m の段差は走りジャンプで乗れる', () => {
    const s = new Sim([wallBox(3, 1.0)]);
    s.run(0.4, forward(1));
    s.step({ ...forward(1), jump: true });
    s.run(1.5, forward(1));
    expect(s.player.position.y).toBeCloseTo(1.0, 2);
  });
  it('壁に斜めに走り込んでも止まらず壁に沿って滑る', () => {
    const s = new Sim([wallBox(2, 4, { unclimbable: true, width: 40 })]);
    s.run(2, stickInput(1, 1));
    expect(Math.abs(s.player.position.x)).toBeGreaterThan(3);
    expect(s.player.position.z).toBeLessThan(2);
  });
  it('斜度 45 度の滑り面では Slide になり、ジャンプできず、スタミナも回復しない', () => {
    const n = Math.SQRT1_2;
    const s = new Sim(
      [{ kind: 'plane', point: vec3(0, 0, 5), normal: vec3(0, n, -n) }],
      vec3(0, 3, 5 + 3),
      0,
    );
    s.player = {
      ...s.player,
      grounded: false,
      name: 'fall',
      stamina: { value: 50, regenDelayRemaining: 0 },
    };
    s.until((p) => p.name === 'slide', forward(1), 2);
    expect(s.player.name).toBe('slide');
    s.step({ ...forward(1), jump: true });
    expect(s.player.name).toBe('slide');
    s.run(0.5, forward(1));
    expect(s.player.stamina.value).toBe(50);
    expect(s.player.position.y).toBeLessThan(3);
  });
  it('ステージ外(±30 m)へは出られない', () => {
    const s = new Sim([], vec3(0, 0, 29.5));
    s.run(1, forward(1));
    expect(s.player.position.z).toBeLessThanOrEqual(config.physics.worldBound);
  });
});
