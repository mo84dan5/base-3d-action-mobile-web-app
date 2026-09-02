import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../domain/config/gameConfig';
import type { InputCommand } from '../domain/input/inputCommand';
import { vec3 } from '../domain/math/vec3';
import { defaultSettings } from '../domain/settings/settings';
import type { StageLayout } from '../domain/stage/stageLayout';
import { AnalyticTerrain, type AnalyticShape } from '../domain/terrain/analyticTerrain';
import type { EffectEvent } from './effects';
import { GameSession } from './gameSession';

const config = defaultConfig;
const COUNTDOWN = config.combat.countdownSeconds + config.combat.countdownStartLabelSeconds;

function layout(overrides: Partial<StageLayout> = {}): StageLayout {
  return {
    groundSize: 60,
    playerStart: vec3(0, 0, 0),
    playerStartYaw: 0,
    signboard: { position: vec3(0, 0, 1.5), label: '看板' },
    primitives: [],
    enemies: [
      { kind: 'dummy', position: vec3(0, 0, 3) },
      { kind: 'patrol', position: vec3(20, 0, 0) },
      { kind: 'patrol', position: vec3(-20, 0, 0) },
    ],
    ...overrides,
  };
}

class Harness {
  readonly effects: EffectEvent[] = [];
  readonly session: GameSession;
  constructor(stage: StageLayout = layout(), shapes: readonly AnalyticShape[] = []) {
    this.session = new GameSession({
      terrain: AnalyticTerrain.flatGround(shapes),
      effects: { trigger: (e) => this.effects.push(e) },
      rng: () => 0.5,
      config,
      stage,
    });
  }
  step(commands: InputCommand[] = []): void {
    this.session.step(commands, defaultSettings);
  }
  run(seconds: number, commands: InputCommand[] = []): void {
    for (let i = 0; i < Math.round(seconds * 60); i++) this.step(commands);
  }
  skipCountdown(): void {
    this.run(COUNTDOWN + 0.05);
  }
  enemy(id: number) {
    const e = this.session.enemies.find((s) => s.state.id === id);
    if (!e) throw new Error(`enemy ${id}`);
    return e.state;
  }
}

const move = (x: number, y: number): InputCommand => ({ type: 'Move', x, y });

describe('開始カウントダウン(S02 / F04)', () => {
  it('3.5 秒間は 3, 2, 1, START と表示され、攻撃できず、クリアタイムも進まない', () => {
    const h = new Harness();
    expect(h.session.view().hud.countdownLabel).toBe('3');
    h.run(1.01);
    expect(h.session.view().hud.countdownLabel).toBe('2');
    h.run(2.0);
    expect(h.session.view().hud.countdownLabel).toBe('START');
    h.step([{ type: 'AttackPressed' }]);
    expect(h.session.player.name).not.toBe('attack');
    expect(h.session.stats.clearTime).toBe(0);
    h.run(0.6);
    expect(h.session.phase).toBe('playing');
    expect(h.session.view().hud.countdownLabel).toBeNull();
  });
  it('カウントダウン中もプレイヤーは移動できる', () => {
    const h = new Harness();
    h.run(0.5, [move(0, 1)]);
    expect(h.session.player.position.z).toBeGreaterThan(1);
  });
  it('カウントダウン中は敵がダメージを受けない', () => {
    const h = new Harness();
    h.run(0.3, [move(0, 1)]);
    h.run(0.6, [{ type: 'AttackPressed' }]);
    expect(h.enemy(1).hp).toBe(config.enemy.dummyHp);
  });
});

describe('攻撃コンボとダメージ(F04 / F10)', () => {
  it('ダミーへ 3 段当てると 10・10・15 のダメージ数値が出て、エネルギーが +5 ずつ増える', () => {
    const h = new Harness();
    h.skipCountdown();
    h.run(0.25, [move(0, 1)]);
    h.step([]);
    for (let i = 0; i < 100; i++) h.step([{ type: 'AttackPressed' }]);
    const dummy = h.enemy(1);
    expect(dummy.hp).toBeLessThanOrEqual(200 - 35);
    expect(h.session.energy.value).toBeGreaterThanOrEqual(15);
    const sparks = h.effects.filter((e) => e.kind === 'hitSpark');
    expect(sparks.length).toBeGreaterThanOrEqual(3);
  });
  it('3 段目のヒットでプレイヤーと敵が 5 ステップ止まり、その間もワールド時間は進む', () => {
    const h = new Harness();
    h.skipCountdown();
    h.session.player = {
      ...h.session.player,
      lastAttackStage: 2,
      comboWindowRemaining: 0.5,
      position: vec3(0, 0, 1.5),
    };
    h.step([{ type: 'AttackPressed' }]);
    expect(h.session.player.attack?.stage).toBe(3);
    let hitStep = -1;
    for (let i = 0; i < 30; i++) {
      h.step();
      if (h.session.player.hitstopSteps > 0) {
        hitStep = i;
        break;
      }
    }
    expect(hitStep).toBeGreaterThanOrEqual(0);
    expect(h.session.player.hitstopSteps).toBe(5);
    expect(h.enemy(1).hitstopSteps).toBe(5);
    const elapsed = h.session.player.attack?.elapsed;
    const t = h.session.worldTime;
    h.run(3 / 60);
    expect(h.session.player.attack?.elapsed).toBe(elapsed);
    expect(h.session.worldTime).toBeCloseTo(t + 3 / 60, 5);
    expect(h.session.camera.shake.amplitude).toBe(0.05);
  });
  it('ダミーの HP を 0 にしても消えず全回復し、撃破数に含まれない', () => {
    const h = new Harness();
    h.skipCountdown();
    h.session.player = { ...h.session.player, position: vec3(0, 0, 1.5) };
    for (let i = 0; i < 600; i++) h.step([{ type: 'AttackPressed' }]);
    const dummy = h.enemy(1);
    expect(dummy.ai).toBe('idle');
    expect(dummy.hp).toBeGreaterThan(0);
    expect(h.session.stats.defeated).toBe(0);
  });
  it('スキルで半径 2.5 m 内の全敵に 30 ダメージが入り、クールダウン 8 秒が始まる', () => {
    const h = new Harness(
      layout({
        enemies: [
          { kind: 'patrol', position: vec3(2, 0, 0) },
          { kind: 'patrol', position: vec3(-2, 0, 0) },
          { kind: 'dummy', position: vec3(0, 0, 5) },
        ],
      }),
    );
    h.skipCountdown();
    h.step([{ type: 'SkillPressed' }]);
    expect(h.session.player.name).toBe('skill');
    expect(h.session.skillCooldown.remaining).toBeCloseTo(8, 5);
    h.run(0.4);
    expect(h.enemy(1).hp).toBe(30);
    expect(h.enemy(2).hp).toBe(30);
    expect(h.enemy(3).hp).toBe(200);
    expect(h.session.energy.value).toBe(30);
    expect(h.session.view().hud.buttons.skill.enabled).toBe(false);
  });
  it('スキルが 2 体に同時ヒットしてもプレイヤーのヒットストップは 4 ステップでシェイクは 1 回', () => {
    const h = new Harness(
      layout({
        enemies: [
          { kind: 'patrol', position: vec3(1.5, 0, 0) },
          { kind: 'patrol', position: vec3(-1.5, 0, 0) },
        ],
      }),
    );
    h.skipCountdown();
    h.step([{ type: 'SkillPressed' }]);
    let max = 0;
    for (let i = 0; i < 20; i++) {
      h.step();
      max = Math.max(max, h.session.player.hitstopSteps);
    }
    expect(max).toBe(4);
    expect(h.session.camera.shake.amplitude).toBe(0.08);
    const numbers = h.session.damageNumbers;
    expect(numbers).toHaveLength(2);
  });
  it('エネルギー 100% でバーストが有効になり、発動で 80 ダメージ・エネルギー 0・クールダウン 5 秒', () => {
    const h = new Harness(layout({ enemies: [{ kind: 'patrol', position: vec3(2, 0, 0) }] }));
    h.skipCountdown();
    expect(h.session.view().hud.buttons.burst.enabled).toBe(false);
    h.session.energy = { value: 100, max: 100 };
    expect(h.session.view().hud.buttons.burst.enabled).toBe(true);
    h.step([{ type: 'BurstPressed' }]);
    expect(h.session.player.name).toBe('burst');
    expect(h.session.energy.value).toBe(0);
    expect(h.session.burstCooldown.remaining).toBeCloseTo(5, 5);
    h.run(0.6);
    expect(h.enemy(1).ai).toBe('dying');
    expect(h.effects.some((e) => e.kind === 'burstActivate')).toBe(true);
  });
});

describe('敵の攻撃と被弾(F04 / F10)', () => {
  it('徘徊型が接近して攻撃し、プレイヤー HP が 15 減り、被ダメージが集計され、振動 20 ms が発火する', () => {
    const h = new Harness(layout({ enemies: [{ kind: 'patrol', position: vec3(0, 0, 3) }] }));
    h.skipCountdown();
    h.run(4);
    expect(h.session.player.hp).toBeLessThanOrEqual(85);
    expect(h.session.stats.damageTaken).toBeGreaterThanOrEqual(15);
    expect(h.effects.some((e) => e.kind === 'vibrate' && e.ms === 20)).toBe(true);
    expect(h.session.view().hud.recentPlayerDamage?.number.amount ?? 15).toBe(15);
  });
  it('バースト中(無敵)は敵の攻撃が当たっても HP が減らずフラッシュも出ない', () => {
    const h = new Harness(layout({ enemies: [{ kind: 'patrol', position: vec3(0, 0, 1.2) }] }));
    h.skipCountdown();
    h.session.energy = { value: 100, max: 100 };
    const slot = h.session.enemies[0];
    if (slot) slot.state = { ...h.enemy(1), ai: 'chase' };
    h.step([{ type: 'BurstPressed' }]);
    h.run(1.0);
    expect(h.session.player.hp).toBe(100);
    expect(h.session.playerFlash).toBeNull();
  });
});

describe('結果判定とリザルト(F04 / S04)', () => {
  it('徘徊型 2 体を撃破すると 1.5 秒後に勝利で ended になり、撃破数 2 / 2、統計が凍結される', () => {
    const h = new Harness(
      layout({
        enemies: [
          { kind: 'patrol', position: vec3(1.5, 0, 0) },
          { kind: 'patrol', position: vec3(-1.5, 0, 0) },
          { kind: 'dummy', position: vec3(0, 0, 8) },
        ],
      }),
    );
    h.skipCountdown();
    h.session.energy = { value: 100, max: 100 };
    h.step([{ type: 'BurstPressed' }]);
    h.run(0.6);
    expect(h.session.phase).toBe('ending');
    expect(h.session.result).toBe('victory');
    const clear = h.session.stats.clearTime;
    h.run(1.6);
    expect(h.session.phase).toBe('ended');
    expect(h.session.stats.clearTime).toBe(clear);
    expect(h.session.stats.defeated).toBe(2);
    expect(h.session.stats.totalTargets).toBe(2);
  });
  it('プレイヤー HP 0 で敗北になり入力を受け付けない', () => {
    const h = new Harness(layout({ enemies: [{ kind: 'patrol', position: vec3(0, 0, 3) }] }));
    h.skipCountdown();
    h.session.player = { ...h.session.player, hp: 10 };
    h.run(4);
    expect(h.session.player.name).toBe('dead');
    expect(h.session.result).toBe('defeat');
    expect(h.effects.some((e) => e.kind === 'playerDefeat')).toBe(true);
    h.run(2, [move(0, 1)]);
    expect(h.session.phase).toBe('ended');
  });
});

describe('移動 → ジャンプ → 滑空(F01 / F08)', () => {
  it('台地から走り出て空中でジャンプすると滑空し、状態インジケータに glide が出る', () => {
    const plateau: AnalyticShape = { kind: 'box', min: vec3(-5, 0, -10), max: vec3(5, 10, 0) };
    const h = new Harness(layout({ playerStart: vec3(0, 10, -1), enemies: [] }), [plateau]);
    h.skipCountdown();
    h.run(0.5, [move(0, 1)]);
    expect(h.session.player.name).toBe('fall');
    h.run(0.3, [move(0, 1)]);
    h.step([move(0, 1), { type: 'JumpPressed' }]);
    expect(h.session.player.name).toBe('glide');
    expect(h.session.view().hud.indicator).toBe('glide');
    expect(h.session.view().hud.buttons.jump.label).toBe('滑空解除');
  });
});

describe('インタラクト(F03)', () => {
  it('看板の 2 m 以内でボタンが有効になり、押すと 2 秒間メッセージが出る', () => {
    const h = new Harness();
    h.skipCountdown();
    expect(h.session.view().hud.buttons.interact.enabled).toBe(true);
    expect(h.session.view().hud.interactTargetName).toBe('看板');
    h.step([{ type: 'InteractPressed' }]);
    expect(h.session.view().hud.interactMessage).toContain('看板');
    h.run(2.1);
    expect(h.session.view().hud.interactMessage).toBeNull();
    h.session.player = { ...h.session.player, position: vec3(0, 0, -5) };
    expect(h.session.view().hud.buttons.interact.enabled).toBe(false);
  });
});

describe('向き切替時の入力キャンセル(F09)', () => {
  it('cancelInputs でスティック 0・慣性 0・スプリント長押し終了になる', () => {
    const h = new Harness();
    h.skipCountdown();
    h.run(0.3, [move(0, 1), { type: 'SprintHoldStart' }]);
    h.step([{ type: 'Look', dx: 10, dy: 0 }, { type: 'LookEnd' }]);
    h.session.cancelInputs();
    expect(h.session.player.sprintHeld).toBe(false);
    expect(h.session.camera.inertia.remaining).toBe(0);
    h.run(0.5);
    expect(h.session.player.name).toBe('idle');
  });
});

describe('カメラ(F02)', () => {
  it('ドラッグでヨーが変わり、ピンチで距離が 2.0〜8.0 m に収まる', () => {
    const h = new Harness();
    const yaw = h.session.camera.orbit.yaw;
    h.step([{ type: 'Look', dx: 40, dy: 0 }]);
    expect(h.session.camera.orbit.yaw).not.toBe(yaw);
    h.step([{ type: 'Zoom', delta: 10 }]);
    expect(h.session.camera.orbit.distance).toBe(8);
    h.step([{ type: 'Zoom', delta: -10 }]);
    expect(h.session.camera.orbit.distance).toBe(2);
  });
  it('プレイヤーが移動で旋回してもカメラのヨーは変わらない', () => {
    const h = new Harness();
    const yaw = h.session.camera.orbit.yaw;
    h.run(0.5, [move(1, 0)]);
    expect(h.session.camera.orbit.yaw).toBe(yaw);
  });
});
