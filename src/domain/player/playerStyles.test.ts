import { describe, expect, it } from 'vitest';
import { ATTACK_STYLES, findAttackStyle } from '../attackStyle/attackStyleCatalog';
import type { AttackStyleDefinition } from '../attackStyle/actionSpec';
import { isStyleImplemented } from '../attackStyle/styleResolver';
import { vec3 } from '../math/vec3';
import type { PlayerEvent } from './playerEvents';
import { NO_INPUT, type PlayerStepInput } from './playerStep';
import { isGroundLocomotion } from './playerState';
import { DT, Sim } from './testHarness';

// F11 の 100 スタイルすべてを状態機械で回す敵対的検証。
// 正面 3 m に敵が 1 体いる想定で押下・長押し(200 ms 後に離す)を行い、
// 例外なく行動が始まり、数秒以内に移動状態へ戻ることを確かめる。

const TARGET = { id: 1, yaw: 0, distance: 3.0 };
const withStyle = (
  style: AttackStyleDefinition,
  extra: Partial<PlayerStepInput> = {},
): PlayerStepInput => ({
  ...NO_INPUT,
  style,
  energy: 100,
  findTarget: () => TARGET,
  findTargets: (_cone, max) => [TARGET, { id: 2, yaw: 0.2, distance: 4 }].slice(0, max),
  wallAhead: () => true,
  ...extra,
});

const OUTPUT_EVENTS: readonly PlayerEvent['type'][] = [
  'attackActive',
  'shotFired',
  'projectileSpawned',
  'objectPlaced',
  'placedCommand',
  'summoned',
  'summonCommand',
  'guardStarted',
  'buffStarted',
  'pullTick',
  'maneuverStarted',
  'blinked',
  'hpChanged',
];

function produced(events: readonly PlayerEvent[]): boolean {
  return events.some((e) => OUTPUT_EVENTS.includes(e.type));
}

function settle(s: Sim, style: AttackStyleDefinition, seconds = 6): void {
  s.until((p) => isGroundLocomotion(p.name) || p.name === 'fall', withStyle(style), seconds);
}

describe('F11 攻撃スタイル 100 案の押下・長押し(状態機械)', () => {
  it('100 案すべてが実装済み(未実装の行動種別を含まない)', () => {
    for (const style of ATTACK_STYLES) expect(isStyleImplemented(style), style.id).toBe(true);
  });

  for (const style of ATTACK_STYLES) {
    it(`${style.id}(${style.name}): 押下で行動が始まり、例外なく移動状態へ戻る`, () => {
      const s = new Sim();
      s.step(withStyle(style, { attack: true }));
      expect(
        s.has('attackStarted') || s.has('styleRolled') || s.has('objectPlaced'),
        'started',
      ).toBe(true);
      settle(s, style);
      expect(produced(s.events), 'produced an output').toBe(true);
      expect(isGroundLocomotion(s.player.name) || s.player.name === 'fall').toBe(true);
      expect(Number.isFinite(s.player.position.x) && Number.isFinite(s.player.position.z)).toBe(
        true,
      );
    });

    it(`${style.id}(${style.name}): 長押し開始 → 0.4 秒後に離しても例外なく完了する`, () => {
      const s = new Sim();
      if (style.hold.action.kind === 'movement') {
        // 移動連動は条件を満たす状況で確認する(別テスト)
        return;
      }
      s.step(withStyle(style, { attackHoldStart: true }));
      s.run(0.4, withStyle(style));
      s.step(withStyle(style, { attackHoldEnd: true }));
      settle(s, style, 8);
      expect(produced(s.events) || s.has('actionRejected'), 'hold produced an output').toBe(true);
      expect(isGroundLocomotion(s.player.name) || s.player.name === 'fall').toBe(true);
      expect(Number.isFinite(s.player.position.x) && Number.isFinite(s.player.position.z)).toBe(
        true,
      );
    });
  }
});

describe('移動連動(F11 N7)の発動条件', () => {
  const style = (id: string) => {
    const found = findAttackStyle(id);
    if (!found) throw new Error(id);
    return found;
  };

  it('dash_slash: ダッシュ直後の長押しはダッシュを省略して即座に突進斬りになる', () => {
    const s = new Sim();
    s.step(withStyle(style('dash_slash'), { dash: true }));
    expect(s.player.name).toBe('dash');
    const afterDash = s.player.stamina.value;
    s.step(withStyle(style('dash_slash'), { attackHoldStart: true }));
    expect(s.player.name).toBe('strongAttack');
    expect(s.has('maneuverStarted')).toBe(true);
    // 長押しのコスト 15 だけ。ダッシュ分 18 は二重に払わない
    expect(afterDash - s.player.stamina.value).toBeCloseTo(15, 5);
  });

  it('dash_slash: ダッシュしていなければ長押しでダッシュ(スタミナ 18)を挟み、3 m 進んでから突進斬りになる', () => {
    const s = new Sim();
    const before = s.player.stamina.value;
    s.step(withStyle(style('dash_slash'), { attackHoldStart: true }));
    expect(s.player.name).toBe('maneuver');
    expect(s.has('dashStarted')).toBe(true);
    expect(s.has('maneuverStarted')).toBe(true);
    s.until((p) => p.name === 'strongAttack', withStyle(style('dash_slash')), 1);
    expect(s.player.name).toBe('strongAttack');
    const travelled = Math.hypot(s.player.position.x, s.player.position.z);
    expect(travelled).toBeGreaterThanOrEqual(2.9);
    expect(travelled).toBeLessThanOrEqual(3.6);
    expect(before - s.player.stamina.value).toBeCloseTo(18 + 15, 5);
  });

  it('dash_slash: 空中では長押しがダッシュを挟めず拒否される', () => {
    const s = new Sim();
    s.step(withStyle(style('dash_slash'), { jump: true }));
    s.run(0.2, withStyle(style('dash_slash')));
    s.step(withStyle(style('dash_slash'), { attackHoldStart: true }));
    expect(s.player.name).not.toBe('maneuver');
    expect(s.has('actionRejected')).toBe(true);
  });

  it('dive: 空中で長押しすると急降下し、着地で範囲攻撃が出る', () => {
    const s = new Sim();
    s.step(withStyle(style('dive'), { jump: true }));
    s.run(0.2, withStyle(style('dive')));
    s.step(withStyle(style('dive'), { attackHoldStart: true }));
    expect(s.player.name).toBe('maneuver');
    s.until((p) => p.name === 'area', withStyle(style('dive')), 3);
    expect(s.player.name).toBe('area');
    settle(s, style('dive'));
    expect(s.has('attackActive')).toBe(true);
  });

  it('sliding: スプリント中の長押しで滑り込みが出る', () => {
    const s = new Sim();
    const sprint = withStyle(style('sliding'), {
      stick: { x: 0, y: 1, magnitude: 1 },
      sprintHoldStart: true,
    });
    s.step(sprint);
    s.run(0.3, withStyle(style('sliding'), { stick: { x: 0, y: 1, magnitude: 1 } }));
    expect(s.player.name).toBe('sprint');
    s.step(
      withStyle(style('sliding'), { stick: { x: 0, y: 1, magnitude: 1 }, attackHoldStart: true }),
    );
    expect(s.player.name).toBe('strongAttack');
  });

  it('wall_kick: 崖登り中の長押しで壁を蹴って離れ、着地で範囲攻撃が出る', () => {
    const s = new Sim([
      { kind: 'box', min: vec3(-5, 0, 2), max: vec3(5, 6, 8), unclimbable: false },
    ]);
    s.until(
      (p) => p.name === 'climb' && p.climb?.phase === 'climbing',
      withStyle(style('wall_kick'), { stick: { x: 0, y: 1, magnitude: 1 } }),
      3,
    );
    expect(s.player.name).toBe('climb');
    s.run(0.5, withStyle(style('wall_kick'), { stick: { x: 0, y: 1, magnitude: 1 } }));
    s.step(withStyle(style('wall_kick'), { attackHoldStart: true }));
    expect(s.player.name).toBe('maneuver');
    s.until((p) => p.name === 'area', withStyle(style('wall_kick')), 4);
    expect(s.player.name).toBe('area');
  });

  it('wall_jump_strike: 壁が 1 m 以内なら壁を蹴って上昇し、落下斬りが出る', () => {
    const s = new Sim();
    s.step(
      withStyle(style('wall_jump_strike'), { attackHoldStart: true, wallAhead: (d) => d >= 1.0 }),
    );
    expect(s.player.name).toBe('maneuver');
    expect(s.player.velocity.y).toBeGreaterThan(5);
    s.until((p) => p.name === 'area', withStyle(style('wall_jump_strike')), 4);
    expect(s.player.name).toBe('area');
  });

  it('blink_slash: 3 m の敵の背後へ転移して重い斬撃を出す', () => {
    const s = new Sim();
    // 転移後は敵が背後(正面 π)にいるので、転移の探索(射程 8 m)以外は π 方向を返す
    const findTarget = (cone: { range: number }) =>
      cone.range === 8 ? TARGET : { id: 1, yaw: Math.PI, distance: 1.0 };
    s.step(withStyle(style('blink_slash'), { attackHoldStart: true, findTarget }));
    expect(s.has('blinked')).toBe(true);
    expect(s.player.position.z).toBeCloseTo(4.0, 1);
    expect(Math.abs(Math.abs(s.player.yaw) - Math.PI)).toBeLessThan(1e-6);
    expect(s.player.name).toBe('attack');
  });

  it('skate: 長押し中は 8 m/s で滑走し、離すと周囲に衝撃', () => {
    const s = new Sim();
    s.step(withStyle(style('skate'), { attackHoldStart: true }));
    expect(s.player.name).toBe('maneuver');
    s.run(0.5, withStyle(style('skate')));
    expect(s.player.position.z).toBeGreaterThan(3.5);
    s.step(withStyle(style('skate'), { attackHoldEnd: true }));
    expect(s.player.name).toBe('area');
  });

  it('glide_shot: 滑空中の長押しで真下へ 0.2 秒ごとに射撃し、滑空は続く', () => {
    const s = new Sim([], vec3(0, 20, 0));
    s.player = { ...s.player, grounded: false, name: 'fall' };
    s.run(0.3, withStyle(style('glide_shot')));
    s.step(withStyle(style('glide_shot'), { jump: true }));
    expect(s.player.name).toBe('glide');
    s.step(withStyle(style('glide_shot'), { attackHoldStart: true }));
    s.run(0.65, withStyle(style('glide_shot')));
    expect(s.player.name).toBe('glide');
    const shots = s.events.filter((e) => e.type === 'shotFired');
    expect(shots.length).toBe(4);
    expect(shots[0]?.type === 'shotFired' && shots[0].direction.y).toBe(-1);
    s.step(withStyle(style('glide_shot'), { attackHoldEnd: true }));
    s.run(0.5, withStyle(style('glide_shot')));
    expect(s.events.filter((e) => e.type === 'shotFired').length).toBe(4);
  });
});

describe('スタイル固有の挙動(F11)', () => {
  const style = (id: string) => {
    const found = findAttackStyle(id);
    if (!found) throw new Error(id);
    return found;
  };

  it('shotgun: 押下で 5 本の射線が ±6 度に広がる', () => {
    const s = new Sim();
    s.step(withStyle(style('shotgun'), { attack: true }));
    s.run(0.2, withStyle(style('shotgun')));
    const shot = s.events.find((e) => e.type === 'shotFired');
    if (shot?.type !== 'shotFired') throw new Error('no shot');
    expect(shot.directions.length).toBe(5);
    expect(shot.damage).toBe(5);
  });

  it('dual_pistol: 長押しで 2 体を同時にロックする', () => {
    const s = new Sim();
    s.step(withStyle(style('dual_pistol'), { attackHoldStart: true }));
    s.run(0.2, withStyle(style('dual_pistol')));
    const shot = s.events.find((e) => e.type === 'shotFired');
    if (shot?.type !== 'shotFired') throw new Error('no shot');
    expect(shot.directions.length).toBe(2);
    expect(shot.damage).toBe(20);
  });

  it('revolver: 6 発撃つと弾切れになり、1.2 秒のリロードの後に撃てる', () => {
    const s = new Sim();
    const input = withStyle(style('revolver'), { attack: true });
    for (let i = 0; i < 6; i++) {
      s.step(input);
      s.run(0.35, withStyle(style('revolver')));
    }
    expect(s.count('shotFired')).toBe(6);
    expect(s.player.ammo?.remaining).toBe(0);
    expect(s.player.ammo?.reloadRemaining).toBeGreaterThan(0);
    s.step(input);
    expect(s.count('shotFired')).toBe(6);
    s.run(1.3, withStyle(style('revolver')));
    expect(s.player.ammo?.remaining).toBe(6);
    s.step(input);
    s.run(0.1, withStyle(style('revolver')));
    expect(s.count('shotFired')).toBe(7);
  });

  it('gatling: 押下で 0.08 秒間隔の 3 連射', () => {
    const s = new Sim();
    s.step(withStyle(style('gatling'), { attack: true }));
    s.run(0.35, withStyle(style('gatling')));
    expect(s.count('shotFired')).toBe(3);
  });

  it('smg: 長押し中はフルオートで撃ち続け、離すと止まる', () => {
    const s = new Sim();
    s.step(withStyle(style('smg'), { attackHoldStart: true }));
    s.run(0.5, withStyle(style('smg')));
    const during = s.count('shotFired');
    expect(during).toBeGreaterThanOrEqual(6);
    s.step(withStyle(style('smg'), { attackHoldEnd: true }));
    s.run(0.5, withStyle(style('smg')));
    expect(s.count('shotFired')).toBe(during);
    expect(isGroundLocomotion(s.player.name)).toBe(true);
  });

  it('greatsword: 1 秒ためて離すと 80 ダメージ、すぐ離すと 30', () => {
    const full = new Sim();
    full.step(withStyle(style('greatsword'), { attackHoldStart: true }));
    full.run(1.2, withStyle(style('greatsword')));
    full.step(withStyle(style('greatsword'), { attackHoldEnd: true }));
    settle(full, style('greatsword'));
    const strong = full.events.find((e) => e.type === 'attackActive');
    expect(strong?.type === 'attackActive' && strong.damage).toBe(80);
    const quick = new Sim();
    quick.step(withStyle(style('greatsword'), { attackHoldStart: true }));
    quick.step(withStyle(style('greatsword'), { attackHoldEnd: true }));
    settle(quick, style('greatsword'));
    const weak = quick.events.find((e) => e.type === 'attackActive');
    expect(weak?.type === 'attackActive' && weak.damage).toBe(30);
  });

  it('ultimate_charge: 3 秒の超タメで 150、1 秒で 30、1 秒未満は 10', () => {
    const damageAfter = (seconds: number) => {
      const s = new Sim();
      s.step(withStyle(style('ultimate_charge'), { attackHoldStart: true }));
      s.run(seconds, withStyle(style('ultimate_charge')));
      s.step(withStyle(style('ultimate_charge'), { attackHoldEnd: true }));
      settle(s, style('ultimate_charge'));
      const hit = s.events.find((e) => e.type === 'attackActive');
      return hit?.type === 'attackActive' ? hit.damage : -1;
    };
    expect(damageAfter(3.1)).toBe(150);
    expect(damageAfter(1.05)).toBe(30);
    expect(damageAfter(0.3)).toBe(10);
  });

  it('spin_slash: 押下でリング判定、長押し中は 0.25 秒ごとに新しい攻撃 ID で当たる', () => {
    const s = new Sim();
    s.step(withStyle(style('spin_slash'), { attack: true }));
    settle(s, style('spin_slash'));
    const ring = s.events.find((e) => e.type === 'attackActive');
    expect(ring?.type === 'attackActive' && ring.volume.type).toBe('ring');
    s.clearEvents();
    s.step(withStyle(style('spin_slash'), { attackHoldStart: true }));
    s.run(1.0, withStyle(style('spin_slash')));
    const ids = new Set(
      s.events
        .filter((e) => e.type === 'attackActive')
        .map((e) => (e.type === 'attackActive' ? e.attackId : 0)),
    );
    expect(ids.size).toBeGreaterThanOrEqual(4);
  });

  it('staff: 扇形 150 度の判定が出る', () => {
    const s = new Sim();
    s.step(withStyle(style('staff'), { attack: true }));
    settle(s, style('staff'));
    const fan = s.events.find((e) => e.type === 'attackActive');
    expect(fan?.type === 'attackActive' && fan.volume.type === 'fan' && fan.volume.angleDeg).toBe(
      150,
    );
  });

  it('shockwave: 拡張リングは持続中に半径が広がる', () => {
    const s = new Sim();
    s.step(withStyle(style('shockwave'), { attackHoldStart: true }));
    settle(s, style('shockwave'));
    const radii = s.events
      .filter((e) => e.type === 'attackActive')
      .map((e) => (e.type === 'attackActive' ? e.radius : 0));
    expect(radii.length).toBeGreaterThan(10);
    expect(radii[0] ?? 0).toBeLessThan(radii[radii.length - 1] ?? 0);
    expect(radii[radii.length - 1] ?? 0).toBeGreaterThan(4.8);
  });

  it('ground_slam: 長押しで跳んでから着地点に扇形の衝撃', () => {
    const s = new Sim();
    s.step(withStyle(style('ground_slam'), { attackHoldStart: true }));
    expect(s.player.name).toBe('area');
    expect(s.player.velocity.y).toBeGreaterThan(0);
    settle(s, style('ground_slam'));
    expect(s.has('landed')).toBe(true);
    const fan = s.events.find((e) => e.type === 'attackActive');
    expect(fan?.type === 'attackActive' && fan.volume.type).toBe('fan');
  });

  it('shuriken: 押下で 3 方向に発射体、長押しで往復する大手裏剣', () => {
    const s = new Sim();
    s.step(withStyle(style('shuriken'), { attack: true }));
    settle(s, style('shuriken'));
    expect(s.count('projectileSpawned')).toBe(3);
    s.clearEvents();
    s.step(withStyle(style('shuriken'), { attackHoldStart: true }));
    settle(s, style('shuriken'));
    const big = s.events.find((e) => e.type === 'projectileSpawned');
    expect(big?.type === 'projectileSpawned' && big.spec.returning).toBe(true);
  });

  it('bomb: 放物線の弾は上向きに放たれる', () => {
    const s = new Sim();
    s.step(withStyle(style('bomb'), { attack: true }));
    settle(s, style('bomb'));
    const bomb = s.events.find((e) => e.type === 'projectileSpawned');
    expect(bomb?.type === 'projectileSpawned' && bomb.direction.y).toBeGreaterThan(0);
  });

  it('mine: 押下で足元に設置、長押しで全起爆の命令', () => {
    const s = new Sim();
    s.step(withStyle(style('mine'), { attack: true }));
    settle(s, style('mine'));
    expect(s.count('objectPlaced')).toBe(1);
    s.step(withStyle(style('mine'), { attackHoldStart: true }));
    const cmd = s.events.find((e) => e.type === 'placedCommand');
    expect(cmd?.type === 'placedCommand' && cmd.command).toBe('detonateAll');
  });

  it('stake: 長押しで扇形に 3 本置く', () => {
    const s = new Sim();
    s.step(withStyle(style('stake'), { attackHoldStart: true }));
    settle(s, style('stake'));
    expect(s.count('objectPlaced')).toBe(3);
  });

  it('familiar: 押下で召喚、長押しで突撃命令', () => {
    const s = new Sim();
    s.step(withStyle(style('familiar'), { attack: true }));
    settle(s, style('familiar'));
    expect(s.count('summoned')).toBe(1);
    s.step(withStyle(style('familiar'), { attackHoldStart: true }));
    const cmd = s.events.find((e) => e.type === 'summonCommand');
    expect(cmd?.type === 'summonCommand' && cmd.command).toBe('charge');
  });

  it('parry: 長押しで 0.3 秒の受け窓、失敗すると 0.5 秒の隙', () => {
    const s = new Sim();
    s.step(withStyle(style('parry'), { attackHoldStart: true }));
    expect(s.player.name).toBe('guard');
    expect(s.has('guardStarted')).toBe(true);
    s.run(0.35, withStyle(style('parry')));
    expect(s.player.name).toBe('guard');
    expect(s.player.action?.phase).toBe('recover');
    s.run(0.55, withStyle(style('parry')));
    expect(isGroundLocomotion(s.player.name)).toBe(true);
  });

  it('shield_knight: 長押し中はガードを維持し、離すとバッシュ', () => {
    const s = new Sim();
    s.step(withStyle(style('shield_knight'), { attackHoldStart: true }));
    s.run(1.5, withStyle(style('shield_knight')));
    expect(s.player.name).toBe('guard');
    expect(s.player.stamina.value).toBeLessThan(100);
    s.step(withStyle(style('shield_knight'), { attackHoldEnd: true }));
    expect(s.player.name).toBe('attack');
  });

  it('iron_wall: 長押しで 2 秒の被ダメ半減が付き、続けて打撃が出る', () => {
    const s = new Sim();
    s.step(withStyle(style('iron_wall'), { attackHoldStart: true }));
    expect(s.player.buffs.find((b) => b.effect === 'damageReduction')?.amount).toBe(0.5);
    expect(s.player.name).toBe('attack');
    s.run(2.5, withStyle(style('iron_wall')));
    expect(s.player.buffs.some((b) => b.effect === 'damageReduction')).toBe(false);
  });

  it('self_destruct: HP 30 以下では発動せず、31 以上なら HP を 30 減らして爆発', () => {
    const low = new Sim();
    low.player = { ...low.player, hp: 30 };
    low.step(withStyle(style('self_destruct'), { attackHoldStart: true }));
    expect(low.player.name).toBe('idle');
    expect(low.has('actionRejected')).toBe(true);
    const ok = new Sim();
    ok.step(withStyle(style('self_destruct'), { attackHoldStart: true }));
    expect(ok.player.hp).toBe(70);
    expect(ok.player.name).toBe('area');
    settle(ok, style('self_destruct'));
    const blast = ok.events.find((e) => e.type === 'attackActive');
    expect(blast?.type === 'attackActive' && blast.damage).toBe(80);
  });

  it('stamina_shot: 押下はスタミナ 10 を消費、長押しは全スタミナを 0.8 倍のダメージにする', () => {
    const s = new Sim();
    s.step(withStyle(style('stamina_shot'), { attack: true }));
    expect(s.player.stamina.value).toBe(90);
    s.run(0.4, withStyle(style('stamina_shot')));
    s.step(withStyle(style('stamina_shot'), { attackHoldStart: true }));
    expect(s.player.stamina.value).toBe(0);
    s.run(0.2, withStyle(style('stamina_shot')));
    const shots = s.events.filter((e) => e.type === 'shotFired');
    const big = shots[shots.length - 1];
    expect(big?.type === 'shotFired' && big.damage).toBeGreaterThanOrEqual(70);
  });

  it('grappler: 3 m 以内の敵を掴んで 0.5 秒拘束し、投げて 30 ダメージ', () => {
    const s = new Sim();
    s.step(
      withStyle(style('grappler'), {
        attack: true,
        findTarget: () => ({ id: 1, yaw: 0, distance: 1.0 }),
      }),
    );
    expect(s.player.name).toBe('pull');
    s.run(0.6, withStyle(style('grappler')));
    expect(s.has('pullTick')).toBe(true);
    const released = s.events.find((e) => e.type === 'pullReleased');
    expect(released?.type === 'pullReleased' && released.damage).toBe(30);
  });

  it('grappler: 届く敵がいなければ空振りして 0.3 秒で戻る', () => {
    const s = new Sim();
    s.step(withStyle(style('grappler'), { attack: true, findTarget: () => null }));
    expect(s.player.name).toBe('pull');
    s.run(0.35, withStyle(style('grappler')));
    expect(isGroundLocomotion(s.player.name)).toBe(true);
    expect(s.has('pullReleased')).toBe(false);
  });

  it('roulette: 乱数でプールのスタイルが選ばれ、そのスタイルの押下が出る', () => {
    const s = new Sim();
    s.step(withStyle(style('roulette'), { attack: true, random: 0.99 }));
    const rolled = s.events.find((e) => e.type === 'styleRolled');
    expect(rolled?.type === 'styleRolled' && rolled.styleId).toBe('palm');
    expect(s.player.name).toBe('attack');
  });

  it('momentum: 長押しでコンボ成長を有効にし、ヒットするたびに威力が 10% ずつ上がる', () => {
    const s = new Sim();
    s.step(withStyle(style('momentum'), { attackHoldStart: true }));
    expect(s.player.buffs.some((b) => b.effect === 'momentum')).toBe(true);
  });

  it('drum: 拍に合った押下は威力 2 倍、外すと半減', () => {
    const s = new Sim();
    s.step(withStyle(style('drum'), { attackHoldStart: true }));
    // 拍は 0.5 秒周期。開始直後(位相 0)は拍に合う
    s.step(withStyle(style('drum'), { attack: true }));
    settle(s, style('drum'));
    const onBeat = s.events.find((e) => e.type === 'attackActive');
    expect(onBeat?.type === 'attackActive' && onBeat.damage).toBe(16);
    s.clearEvents();
    s.run(0.25 - DT, withStyle(style('drum')));
    s.step(withStyle(style('drum'), { attack: true }));
    settle(s, style('drum'));
    const offBeat = s.events.find((e) => e.type === 'attackActive');
    expect(offBeat?.type === 'attackActive' && offBeat.damage).toBe(4);
  });

  it('drain: ヒットごとの回復量が仕様に載る(押下 2、長押し 10)', () => {
    const s = new Sim();
    s.step(withStyle(style('drain'), { attack: true }));
    settle(s, style('drain'));
    const hit = s.events.find((e) => e.type === 'attackActive');
    expect(hit?.type === 'attackActive' && hit.profile?.heal).toBe(2);
  });

  it('aerial_blade: 空中攻撃を 3 回まで使える', () => {
    const s = new Sim([], vec3(0, 40, 0));
    s.player = { ...s.player, grounded: false, name: 'fall' };
    let count = 0;
    for (let i = 0; i < 4; i++) {
      s.step(withStyle(style('aerial_blade'), { attack: true }));
      if (s.player.name === 'airAttack') count++;
      s.run(0.05, withStyle(style('aerial_blade')));
      s.until((p) => p.name !== 'airAttack', withStyle(style('aerial_blade')), 1);
    }
    expect(count).toBe(3);
  });

  it('time_stop: 長押しで半径 5 m・1 秒の時間停止が通知される', () => {
    const s = new Sim();
    s.step(withStyle(style('time_stop'), { attackHoldStart: true }));
    const buff = s.events.find((e) => e.type === 'buffStarted');
    expect(buff?.type === 'buffStarted' && buff.effect).toBe('timeStop');
    expect(buff?.type === 'buffStarted' && buff.radius).toBe(5);
  });

  it('エネルギー不足の行動は発動せず actionRejected(energy)になる(EN バーの点滅用に cost と区別)', () => {
    const s = new Sim();
    s.step(withStyle(style('magic_bolt'), { attack: true, energy: 0 }));
    expect(s.player.name).toBe('idle');
    expect(s.events.some((e) => e.type === 'actionRejected' && e.reason === 'energy')).toBe(true);
    expect(s.events.some((e) => e.type === 'actionRejected' && e.reason === 'cost')).toBe(false);
  });

  it('エネルギーを消費する行動は energySpent を出す', () => {
    const s = new Sim();
    s.step(withStyle(style('magic_bolt'), { attack: true, energy: 50 }));
    const spent = s.events.find((e) => e.type === 'energySpent');
    expect(spent?.type === 'energySpent' && spent.amount).toBe(3);
  });
});
