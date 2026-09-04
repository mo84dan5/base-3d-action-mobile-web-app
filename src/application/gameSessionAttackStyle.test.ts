import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../domain/config/gameConfig';
import type { InputCommand } from '../domain/input/inputCommand';
import { vec3 } from '../domain/math/vec3';
import { defaultSettings, type Settings } from '../domain/settings/settings';
import type { StageLayout } from '../domain/stage/stageLayout';
import { AnalyticTerrain, type AnalyticShape } from '../domain/terrain/analyticTerrain';
import type { EffectEvent } from './effects';
import { GameSession } from './gameSession';

const config = defaultConfig;
const COUNTDOWN = config.combat.countdownSeconds + config.combat.countdownStartLabelSeconds;
const GUN: Settings = { ...defaultSettings, attackStyle: 'gun' };

function layout(enemies: StageLayout['enemies']): StageLayout {
  return {
    groundSize: 60,
    playerStart: vec3(0, 0, 0),
    playerStartYaw: 0,
    signboard: { position: vec3(-5, 0, -5), label: '看板' },
    primitives: [],
    enemies,
  };
}

class Harness {
  readonly effects: EffectEvent[] = [];
  readonly session: GameSession;
  constructor(
    stage: StageLayout,
    private readonly settings: Settings,
    shapes: readonly AnalyticShape[] = [],
  ) {
    this.session = new GameSession({
      terrain: AnalyticTerrain.flatGround(shapes),
      effects: { trigger: (e) => this.effects.push(e) },
      rng: () => 0.5,
      config,
      stage,
    });
    for (let i = 0; i < Math.round((COUNTDOWN + 0.05) * 60); i++) this.step();
  }
  step(commands: InputCommand[] = []): void {
    this.session.step(commands, this.settings);
  }
  run(seconds: number, commands: InputCommand[] = []): void {
    for (let i = 0; i < Math.round(seconds * 60); i++) this.step(commands);
  }
  hp(id: number): number {
    return this.session.enemies.find((s) => s.state.id === id)?.state.hp ?? -1;
  }
}

describe('射撃(銃撃スタイル。F04 / F10)', () => {
  it('正面 6 m の敵に 8 ダメージが入り、エネルギー +3、弾道線とマズルフラッシュが出て、シェイクは起きない', () => {
    const h = new Harness(layout([{ kind: 'patrol', position: vec3(0, 0, 6) }]), GUN);
    h.step([{ type: 'AttackPressed' }]);
    h.run(0.3);
    expect(h.hp(1)).toBe(52);
    expect(h.session.energy.value).toBe(3);
    expect(h.effects.some((e) => e.kind === 'tracer' && !e.charged)).toBe(true);
    expect(h.effects.some((e) => e.kind === 'muzzleFlash')).toBe(true);
    expect(h.session.camera.shake.amplitude).toBe(0);
  });
  it('±15 度の外の敵には向きを合わせず当たらない。射程 12 m の外も当たらない', () => {
    const side = new Harness(layout([{ kind: 'patrol', position: vec3(3, 0, 5) }]), GUN);
    side.step([{ type: 'AttackPressed' }]);
    side.run(0.3);
    expect(side.hp(1)).toBe(60);
    const far = new Harness(layout([{ kind: 'patrol', position: vec3(0, 0, 13) }]), GUN);
    far.step([{ type: 'AttackPressed' }]);
    far.run(0.3);
    expect(far.hp(1)).toBe(60);
  });
  it('地形に遮られると当たらない', () => {
    const h = new Harness(layout([{ kind: 'patrol', position: vec3(0, 0, 8) }]), GUN, [
      { kind: 'box', min: vec3(-3, 0, 3), max: vec3(3, 3, 4) },
    ]);
    h.step([{ type: 'AttackPressed' }]);
    h.run(0.3);
    expect(h.hp(1)).toBe(60);
    expect(h.effects.some((e) => e.kind === 'tracer' && e.to.z < 3.5)).toBe(true);
  });
  it('連射: 1 秒間押し続けると 4 発当たる(0.25 秒間隔)', () => {
    const h = new Harness(layout([{ kind: 'dummy', position: vec3(0, 0, 5) }]), GUN);
    for (let i = 0; i < 60; i++) h.step(i % 5 === 0 ? [{ type: 'AttackPressed' }] : []);
    h.run(0.3);
    // 0 / 0.25 / 0.5 / 0.75 / 1.0 秒の 5 発(押下は 1 回だけ保持される)
    expect(h.hp(1)).toBe(200 - 8 * 5);
  });
});

describe('タメ打ち(銃撃スタイル。F04 / F10)', () => {
  it('1 秒タメて離すと射線上の 2 体に 60 ダメージが貫通し、シェイク 0.12 m、攻撃側ヒットストップは 1 回(6 ステップ)', () => {
    const h = new Harness(
      layout([
        { kind: 'patrol', position: vec3(0, 0, 4) },
        { kind: 'patrol', position: vec3(0, 0, 9) },
      ]),
      GUN,
    );
    h.step([{ type: 'AttackHoldStart' }]);
    h.run(1.0);
    expect(h.session.view().hud.chargeRatio).toBeCloseTo(1, 1);
    h.step([{ type: 'AttackHoldEnd' }]);
    let maxHitstop = 0;
    let maxShake = 0;
    for (let i = 0; i < 40; i++) {
      h.step();
      maxHitstop = Math.max(maxHitstop, h.session.player.hitstopSteps);
      maxShake = Math.max(maxShake, h.session.camera.shake.amplitude);
    }
    expect(h.hp(1)).toBe(0);
    expect(h.hp(2)).toBe(0);
    expect(maxHitstop).toBe(6);
    expect(maxShake).toBeCloseTo(0.12, 5);
    expect(h.effects.some((e) => e.kind === 'tracer' && e.charged)).toBe(true);
    expect(h.session.damageNumbers.every((n) => n.kind === 'big')).toBe(true);
  });
  it('タメ中に敵の攻撃を受けるとタメが破棄され発射されない', () => {
    const h = new Harness(layout([{ kind: 'patrol', position: vec3(0, 0, 1.3) }]), GUN);
    const slot = h.session.enemies[0];
    if (slot) slot.state = { ...slot.state, ai: 'chase' };
    h.step([{ type: 'AttackHoldStart' }]);
    h.run(1.5);
    expect(h.session.player.hp).toBeLessThan(100);
    expect(h.session.player.name).not.toBe('charge');
    h.step([{ type: 'AttackHoldEnd' }]);
    h.run(0.5);
    expect(h.effects.some((e) => e.kind === 'tracer')).toBe(false);
  });
  it('向き切替の強制解放(cancelInputs)でタメが破棄される', () => {
    const h = new Harness(layout([{ kind: 'patrol', position: vec3(0, 0, 5) }]), GUN);
    h.step([{ type: 'AttackHoldStart' }]);
    h.run(0.5);
    h.session.cancelInputs();
    expect(h.session.player.name).toBe('idle');
    h.step([{ type: 'AttackHoldEnd' }]);
    h.run(0.5);
    expect(h.hp(1)).toBe(60);
  });
});

describe('接近強攻撃(格闘スタイル。F04)', () => {
  it('4 m 先の敵へ踏み込み 35 ダメージ、スタミナ −25、エネルギー +10、シェイク 0.08', () => {
    const h = new Harness(layout([{ kind: 'patrol', position: vec3(0, 0, 4) }]), defaultSettings);
    h.step([{ type: 'AttackPressed' }]);
    h.run(0.2);
    h.step([{ type: 'AttackHoldStart' }]);
    expect(h.session.player.name).toBe('strongAttack');
    expect(h.session.player.stamina.value).toBe(75);
    let maxShake = 0;
    for (let i = 0; i < 72; i++) {
      h.step();
      maxShake = Math.max(maxShake, h.session.camera.shake.amplitude);
    }
    expect(h.hp(1)).toBe(25);
    expect(h.session.energy.value).toBe(10);
    expect(maxShake).toBe(0.08);
    expect(h.effects.some((e) => e.kind === 'lunge')).toBe(true);
    expect(h.effects.some((e) => e.kind === 'attackSwing' && e.attack === 'strongAttack')).toBe(
      true,
    );
  });
  it('格闘スタイルでは AttackHoldEnd は何もしない', () => {
    const h = new Harness(layout([{ kind: 'patrol', position: vec3(0, 0, 5) }]), defaultSettings);
    h.step([{ type: 'AttackHoldEnd' }]);
    expect(h.session.player.name).toBe('idle');
  });
});
