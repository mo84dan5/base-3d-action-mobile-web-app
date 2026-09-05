import { describe, expect, it } from 'vitest';
import { ATTACK_STYLES } from '../domain/attackStyle/attackStyleCatalog';
import { defaultConfig } from '../domain/config/gameConfig';
import type { InputCommand } from '../domain/input/inputCommand';
import { vec3 } from '../domain/math/vec3';
import { defaultSettings, type Settings } from '../domain/settings/settings';
import type { StageLayout } from '../domain/stage/stageLayout';
import { AnalyticTerrain } from '../domain/terrain/analyticTerrain';
import type { EffectEvent } from './effects';
import { GameSession } from './gameSession';

// F11 の 100 スタイルをセッション(ヒット解決・発射体・設置物・召喚体・敵 AI)まで通す敵対的検証。
// 正面 2.5 m と 5 m に徘徊型が 2 体。押下 → 長押し(0.4 秒)→ 離す を行い、
// 例外なく進み、囮と壁以外はどちらかの入力で敵にダメージが入ることを確かめる。

const config = defaultConfig;
const COUNTDOWN = config.combat.countdownSeconds + config.combat.countdownStartLabelSeconds;

function layout(): StageLayout {
  return {
    groundSize: 60,
    playerStart: vec3(0, 0, 0),
    playerStartYaw: 0,
    signboard: { position: vec3(-8, 0, -8), label: '看板' },
    primitives: [],
    enemies: [
      { kind: 'patrol', position: vec3(0, 0, 2.5) },
      { kind: 'patrol', position: vec3(0.5, 0, 5) },
    ],
  };
}

class Harness {
  readonly effects: EffectEvent[] = [];
  readonly session: GameSession;
  constructor(private readonly settings: Settings) {
    this.session = new GameSession({
      terrain: AnalyticTerrain.flatGround([]),
      effects: { trigger: (e) => this.effects.push(e) },
      rng: () => 0.5,
      config,
      stage: layout(),
    });
    for (let i = 0; i < Math.round((COUNTDOWN + 0.05) * 60); i++) this.step();
  }
  step(commands: InputCommand[] = []): void {
    this.session.step(commands, this.settings);
  }
  run(seconds: number, commands: InputCommand[] = []): void {
    for (let i = 0; i < Math.round(seconds * 60); i++) this.step(commands);
  }
  totalHp(): number {
    return this.session.enemies.reduce((sum, s) => sum + s.state.hp, 0);
  }
}

// 敵に触れないスタイル入力(囮・壁は敵を遮る・引き付けるだけ)
const NO_DAMAGE_EXPECTED = new Set(['decoy', 'magic_wall']);

describe('F11 攻撃スタイル 100 案(セッション)', () => {
  for (const style of ATTACK_STYLES) {
    it(`${style.id}(${style.name}): 押下と長押しが例外なく進み、敵にダメージが入る`, () => {
      const h = new Harness({ ...defaultSettings, attackStyle: style.id });
      const before = h.totalHp();
      // エネルギーが要るスタイルのために満タンにしておく
      h.session.energy = { ...h.session.energy, value: h.session.energy.max };
      h.step([{ type: 'AttackPressed' }]);
      h.run(3.0);
      h.session.energy = { ...h.session.energy, value: h.session.energy.max };
      h.step([{ type: 'AttackHoldStart' }]);
      h.run(0.4);
      h.step([{ type: 'AttackHoldEnd' }]);
      h.run(6.0);
      const view = h.session.view();
      expect(view.hud.style.id).toBe(style.id);
      expect(view.hud.style.fallbackFrom).toBeNull();
      expect(Number.isFinite(view.player.position.x)).toBe(true);
      if (NO_DAMAGE_EXPECTED.has(style.id)) {
        expect(h.effects.some((e) => e.kind === 'placed')).toBe(true);
        return;
      }
      expect(h.totalHp(), 'enemy hp decreased').toBeLessThan(before);
    });
  }

  it('未知の ID は格闘へフォールバックし、HUD に元の ID を出す', () => {
    const h = new Harness({ ...defaultSettings, attackStyle: 'no_such_style' });
    h.step();
    const view = h.session.view();
    expect(view.hud.style.id).toBe('melee');
    // 設定の読み込みで melee へ戻るのが正規の経路(F06)。セッション単体では ID をそのまま渡すと fallbackFrom に残る
    expect(view.hud.style.fallbackFrom).toBe('no_such_style');
  });

  it('time_stop: 長押しで半径 5 m の敵が 1 秒間止まる', () => {
    const h = new Harness({ ...defaultSettings, attackStyle: 'time_stop' });
    h.session.energy = { ...h.session.energy, value: 100 };
    h.step([{ type: 'AttackHoldStart' }]);
    const frozen = h.session.enemies.filter((s) => s.state.frozenRemaining > 0);
    expect(frozen.length).toBe(2);
    const positions = h.session.enemies.map((s) => s.state.position);
    h.run(0.5);
    for (let i = 0; i < positions.length; i++) {
      expect(h.session.enemies[i]?.state.position).toEqual(positions[i]);
    }
    h.run(0.6);
    expect(h.session.enemies.every((s) => s.state.frozenRemaining === 0)).toBe(true);
  });

  it('parry: 敵の攻撃をガード窓で受けると被ダメ 0 でカウンターが出る', () => {
    const h = new Harness({ ...defaultSettings, attackStyle: 'parry' });
    // 敵が攻撃の発生(0.6 秒)に入るまで待ってからパリィ
    h.session.enemies = h.session.enemies.slice(0, 1);
    for (let i = 0; i < 60 * 8; i++) {
      h.step();
      const e = h.session.enemies[0]?.state;
      if (e?.ai === 'attack' && e.stateTime > config.enemy.attack.startup - 0.25) break;
    }
    expect(h.session.enemies[0]?.state.ai).toBe('attack');
    const hpBefore = h.session.player.hp;
    h.step([{ type: 'AttackHoldStart' }]);
    expect(h.session.player.name).toBe('guard');
    h.run(0.4);
    expect(h.session.player.hp).toBe(hpBefore);
    expect(h.effects.some((e) => e.kind === 'guard' && e.phase === 'success')).toBe(true);
    expect(h.session.enemies[0]?.state.ai).toBe('stunned');
  });

  it('mine: 置いた地雷に敵が近づくと爆発してダメージ', () => {
    const h = new Harness({ ...defaultSettings, attackStyle: 'mine' });
    h.session.energy = { ...h.session.energy, value: 100 };
    h.step([{ type: 'AttackPressed' }]);
    h.run(0.2);
    expect(h.effects.some((e) => e.kind === 'placed' && e.object === 'mine')).toBe(true);
    h.run(3.0);
    expect(h.session.placed.objects.length).toBe(0);
    expect(h.effects.some((e) => e.kind === 'explosion')).toBe(true);
    expect(h.totalHp()).toBeLessThan(config.enemy.patrolHp * 2);
  });

  it('boomerang: 投げた弾は戻り、戻るまでの間は次を投げられない', () => {
    const h = new Harness({ ...defaultSettings, attackStyle: 'boomerang' });
    h.step([{ type: 'AttackPressed' }]);
    h.run(0.3);
    expect(h.session.projectiles.projectiles.length).toBe(1);
    h.run(2.5);
    expect(h.session.projectiles.projectiles.length).toBe(0);
  });

  it('familiar: 召喚した使い魔が敵を攻撃し、寿命で消える', () => {
    const h = new Harness({ ...defaultSettings, attackStyle: 'familiar' });
    h.session.energy = { ...h.session.energy, value: 100 };
    h.step([{ type: 'AttackPressed' }]);
    h.run(0.5);
    expect(h.session.summons.summons.length).toBe(1);
    const before = h.totalHp();
    h.run(3.5);
    expect(h.totalHp()).toBeLessThan(before);
    h.run(12);
    expect(h.session.summons.summons.length).toBe(0);
  });

  it('dart: 長押しの強化ダーツで継続ダメージが入る', () => {
    const h = new Harness({ ...defaultSettings, attackStyle: 'dart' });
    h.step([{ type: 'AttackHoldStart' }]);
    h.run(0.3);
    const afterHit = h.totalHp();
    expect(h.session.enemies.some((s) => s.state.dot !== null)).toBe(true);
    h.run(2.0);
    expect(h.totalHp()).toBeLessThan(afterHit);
  });

  it('taunt: 長押しで半径 8 m の敵が追跡を始め、5 秒間 攻撃力が 1.5 倍', () => {
    const h = new Harness({ ...defaultSettings, attackStyle: 'taunt' });
    h.session.energy = { ...h.session.energy, value: 100 };
    h.step([{ type: 'AttackHoldStart' }]);
    expect(h.session.enemies.every((s) => s.state.tauntRemaining > 0)).toBe(true);
    h.run(0.6);
    h.step([{ type: 'AttackPressed' }]);
    h.run(0.5);
    const hits = h.session.damageNumbers
      .filter((n) => n.targetId !== 'player')
      .map((n) => n.amount);
    expect(hits).toContain(12);
  });

  it('被ダメ半減(鉄壁)中は敵の攻撃が 10 → 5 になる', () => {
    const h = new Harness({ ...defaultSettings, attackStyle: 'iron_wall' });
    h.session.enemies = h.session.enemies.slice(0, 1);
    h.session.player = {
      ...h.session.player,
      buffs: [
        {
          effect: 'damageReduction',
          amount: 0.5,
          duration: 30,
          remaining: 30,
          stacks: 0,
          maxStacks: 0,
          beatSeconds: 0,
          beatTime: 0,
        },
      ],
    };
    const hpBefore = h.session.player.hp;
    for (let i = 0; i < 60 * 10 && h.session.player.hp === hpBefore; i++) h.step();
    expect(hpBefore - h.session.player.hp).toBe(Math.round(config.enemy.attackDamage * 0.5));
  });
});
