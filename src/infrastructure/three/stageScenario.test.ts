import { describe, expect, it } from 'vitest';
import { FIXED_STEP_SECONDS, defaultConfig } from '../../domain/config/gameConfig';
import { vec3, type Vec3 } from '../../domain/math/vec3';
import { createPlayer } from '../../domain/player/playerFactory';
import type { PlayerEvent } from '../../domain/player/playerEvents';
import type { PlayerState } from '../../domain/player/playerState';
import { NO_INPUT, stepPlayer, type PlayerStepInput } from '../../domain/player/playerStep';
import { stageLayout } from '../../domain/stage/stageLayout';
import { BvhTerrainCollider } from './bvhTerrainCollider';
import { buildStageGeometry } from './stageGeometry';

// 実ステージ(BVH)でのプレイシナリオ検証(F05 検証用ステージ / F08)。
// 単体テストの解析地形では検証できない、配置と地形コリジョンの組み合わせを確かめる。

const config = defaultConfig;
const stage = buildStageGeometry(stageLayout);
const terrain = new BvhTerrainCollider(stage.collision);

// cameraYaw 0: スティック上 = +z、右 = −x
const toward = (x: number, y: number): PlayerStepInput => ({
  ...NO_INPUT,
  stick: { x, y, magnitude: 1 },
});
const PLUS_Z = toward(0, 1);
const MINUS_Z = toward(0, -1);
const MINUS_X = toward(1, 0);
const PLUS_X = toward(-1, 0);

class Run {
  player: PlayerState;
  events: PlayerEvent[] = [];
  maxY = -Infinity;
  states = new Set<string>();

  constructor(start: Vec3, yaw = 0) {
    this.player = createPlayer(start, yaw, config);
  }

  step(input: PlayerStepInput = NO_INPUT): PlayerState {
    const r = stepPlayer(this.player, input, terrain, FIXED_STEP_SECONDS, config);
    this.player = r.player;
    this.events.push(...r.events);
    this.maxY = Math.max(this.maxY, this.player.position.y);
    this.states.add(this.player.name);
    return this.player;
  }

  until(pred: (p: PlayerState) => boolean, input: PlayerStepInput, maxSeconds: number): boolean {
    for (let i = 0; i < Math.round(maxSeconds / FIXED_STEP_SECONDS); i++) {
      if (pred(this.player)) return true;
      this.step(input);
    }
    return pred(this.player);
  }

  run(seconds: number, input: PlayerStepInput = NO_INPUT): void {
    for (let i = 0; i < Math.round(seconds / FIXED_STEP_SECONDS); i++) this.step(input);
  }
}

describe('要素 4: 崖(登攀可、高さ 6 m)', () => {
  it('崖面(z = −20)へ走り込むと取り付き、登って頂上でよじ登り、台地(y = 6)に立つ', () => {
    const r = new Run(vec3(0, 0, -15));
    expect(r.until((p) => p.name === 'climb', MINUS_Z, 5)).toBe(true);
    expect(r.player.position.z).toBeCloseTo(-20 + 0.5, 1);
    expect(r.until((p) => p.climb?.phase === 'mantle', toward(0, 1), 15)).toBe(true);
    expect(r.until((p) => p.name === 'idle', NO_INPUT, 2)).toBe(true);
    expect(r.player.position.y).toBeCloseTo(6, 1);
    expect(r.player.position.z).toBeLessThan(-20);
    expect(r.player.stamina.value).toBeGreaterThan(0);
  });
  it('崖の側面(x = −6)も登攀可になり取り付く', () => {
    const r = new Run(vec3(-8.5, 0, -25), Math.PI / 2);
    expect(r.until((p) => p.name === 'climb', PLUS_X, 3)).toBe(true);
  });
  it('台地の縁から走り出ると落下する(崖端の落下)', () => {
    const r = new Run(vec3(0, 6, -22));
    expect(r.until((p) => p.name === 'fall', PLUS_Z, 3)).toBe(true);
    expect(r.until((p) => p.name === 'idle' || p.name === 'run', PLUS_Z, 3)).toBe(true);
    expect(r.player.position.y).toBeCloseTo(0, 1);
  });
});

describe('要素 5: 高い崖(20 m)とテラス', () => {
  it('x = 16 の面を登るとテラス(高さ 10 m)へよじ登り、残りスタミナで上段を登ると途中で落ちてテラスに戻り回復する', () => {
    const r = new Run(vec3(12, 0, 0), Math.PI / 2);
    expect(r.until((p) => p.name === 'climb', PLUS_X, 5)).toBe(true);
    expect(r.until((p) => p.name === 'idle' && p.position.y > 9, toward(0, 1), 20)).toBe(true);
    expect(r.player.position.y).toBeCloseTo(10, 1);
    expect(r.player.position.x).toBeGreaterThan(16);
    expect(r.player.position.x).toBeLessThan(18.5);
    const staminaOnTerrace = r.player.stamina.value;
    expect(staminaOnTerrace).toBeLessThan(50);
    // 上段(x = 18 の面)へ
    expect(r.until((p) => p.name === 'climb' && p.position.y > 9.5, PLUS_X, 5)).toBe(true);
    expect(r.until((p) => p.name === 'fall', toward(0, 1), 20)).toBe(true);
    expect(r.events.some((e) => e.type === 'staminaDepleted')).toBe(true);
    expect(r.player.position.y).toBeLessThan(20);
    expect(r.until((p) => p.name === 'idle', NO_INPUT, 5)).toBe(true);
    expect(r.player.position.y).toBeCloseTo(10, 1);
    r.run(2.5);
    expect(r.player.stamina.value).toBeGreaterThan(20);
  });
  it('満タンで登れる高さは約 12.5 m(上段の面 x = 18 を高さ 10 m から登る)', () => {
    const r = new Run(vec3(17, 10, 0), Math.PI / 2);
    expect(r.until((p) => p.name === 'climb', PLUS_X, 3)).toBe(true);
    const startY = r.player.position.y;
    r.until((p) => p.name !== 'climb', toward(0, 1), 20);
    // 12.5 m 登る前に頂上(20 m)へ届くため、よじ登りで頂上に立つ
    expect(r.player.name).toBe('idle');
    expect(r.player.position.y).toBeCloseTo(20, 1);
    expect(r.player.position.y - startY).toBeLessThan(12.5);
  });
  it('裏側のスロープ A → B → 橋 で頂上へ歩いて登れる', () => {
    const r = new Run(vec3(-3, 0, 27.5), Math.PI / 2);
    expect(r.until((p) => p.position.x > 25.5 && p.position.y > 9.5, PLUS_X, 15)).toBe(true);
    expect(r.until((p) => p.position.z < -1.2 && p.position.y > 19.5, MINUS_Z, 15)).toBe(true);
    expect(r.until((p) => p.position.x < 24, MINUS_X, 5)).toBe(true);
    expect(r.player.position.y).toBeCloseTo(20, 1);
    expect(r.states.has('climb')).toBe(false);
  });
});

describe('要素 2・3: 丘と急な坂', () => {
  it('斜度 20 度の丘を走りのまま登って頂上(y = 4)に着き、降りられる', () => {
    const r = new Run(vec3(-10, 0, 20));
    expect(r.until((p) => p.position.y > 3.9, MINUS_Z, 10)).toBe(true);
    expect(r.player.name).toBe('run');
    expect(Math.hypot(r.player.velocity.x, r.player.velocity.z)).toBeCloseTo(4.5, 0);
    expect(r.states.has('fall')).toBe(false);
    expect(r.until((p) => p.position.y < 0.1 && p.position.z > 16, PLUS_Z, 10)).toBe(true);
  });
  it('斜度 45 度の坂へ下から歩いても登れず、取り付きも起きない', () => {
    const r = new Run(vec3(12, 0, -14));
    r.run(3, PLUS_Z);
    expect(r.states.has('climb')).toBe(false);
    expect(r.maxY).toBeLessThan(0.5);
    expect(r.player.position.z).toBeLessThan(-11.5);
  });
  it('斜度 45 度の坂に飛び乗ると Slide になって滑り落ち、Slide 中はスタミナが回復しない', () => {
    const r = new Run(vec3(12, 0, -13.2));
    r.player = { ...r.player, stamina: { value: 50, regenDelayRemaining: 0 } };
    r.run(0.2, PLUS_Z);
    r.step({ ...PLUS_Z, jump: true });
    expect(r.until((p) => p.name === 'slide', PLUS_Z, 2)).toBe(true);
    const staminaAtSlide = r.player.stamina.value;
    const yAtSlide = r.player.position.y;
    r.run(0.3, PLUS_Z);
    expect(r.player.stamina.value).toBeLessThanOrEqual(staminaAtSlide);
    expect(r.states.has('climb')).toBe(false);
    expect(r.until((p) => p.name === 'idle' || p.name === 'run', NO_INPUT, 5)).toBe(true);
    expect(r.player.position.y).toBeLessThan(yAtSlide);
    expect(r.maxY).toBeLessThan(3);
  });
});

describe('要素 12: 氷柱(唯一の登攀不可)', () => {
  it('氷柱へ走り込んでも取り付かず、押し戻される', () => {
    const r = new Run(vec3(7, 0, -1));
    r.run(3, PLUS_Z);
    expect(r.states.has('climb')).toBe(false);
    expect(r.player.position.z).toBeLessThan(3 - 1.5);
    expect(r.maxY).toBeLessThan(0.5);
  });
  it('柱(高さ 3 m)は登攀可になり取り付く', () => {
    const r = new Run(vec3(8, 0, 8));
    expect(r.until((p) => p.name === 'climb', PLUS_Z, 3)).toBe(true);
  });
});

describe('要素 7・9・10: 段差・柱・外周', () => {
  it('0.3 m は乗れ、0.5 m は乗れない', () => {
    const low = new Run(vec3(-12, 0, -3));
    low.run(2, MINUS_Z);
    expect(low.player.position.y).toBeCloseTo(0.3, 1);
    const mid = new Run(vec3(-12, 0.3, -6));
    mid.run(2, MINUS_Z);
    expect(mid.player.position.z).toBeGreaterThan(-8);
    expect(mid.player.position.y).toBeCloseTo(0.3, 1);
  });
  it('高い崖の頂上(20 m)から滑空しても外周(±30 m)を越えない', () => {
    const r = new Run(vec3(21, 20, 3));
    expect(r.until((p) => p.name === 'fall', PLUS_Z, 3)).toBe(true);
    r.run(0.3, PLUS_Z);
    r.step({ ...PLUS_Z, jump: true });
    expect(r.player.name).toBe('glide');
    let maxZ = -Infinity;
    for (let i = 0; i < 60 * 20 && r.player.name === 'glide'; i++) {
      r.step(PLUS_Z);
      maxZ = Math.max(maxZ, r.player.position.z);
    }
    expect(maxZ).toBeLessThanOrEqual(30);
    expect(r.player.position.z).toBeLessThanOrEqual(30);
    expect(r.states.has('climb')).toBe(false);
  });
});
