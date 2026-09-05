import { describe, expect, it } from 'vitest';

import { defaultConfig } from '../config/gameConfig';
import { actionKinds, styleActionKinds } from './actionSpec';
import {
  ATTACK_STYLES,
  DEFAULT_ATTACK_STYLE_ID,
  defaultAttackStyle,
  findAttackStyle,
} from './attackStyleCatalog';

// F11 の表と同じ順の ID 一覧。仕様書を更新したらここも更新する
const F11_IDS: readonly string[] = [
  'melee',
  'dual_blade',
  'greatsword',
  'iai',
  'rapier',
  'spin_slash',
  'counter_blade',
  'charge_slash',
  'aerial_blade',
  'sword_wave',
  'boxer',
  'warhammer',
  'staff',
  'palm',
  'kicker',
  'ground_slam',
  'rapid_fist',
  'grappler',
  'shield_bash',
  'iron_shoulder',
  'spear',
  'naginata',
  'lance',
  'javelin',
  'pole_vault',
  'whirlwind',
  'skewer',
  'halberd',
  'twin_spear',
  'scythe',
  'gun',
  'shotgun',
  'rifle',
  'smg',
  'gatling',
  'sniper',
  'revolver',
  'dual_pistol',
  'laser',
  'rocket',
  'bow',
  'crossbow',
  'shuriken',
  'boomerang',
  'throwing_knife',
  'bomb',
  'chakram',
  'sling',
  'needle',
  'dart',
  'magic_bolt',
  'magic_cannon',
  'beam',
  'meteor',
  'shockwave',
  'gravity',
  'mirage',
  'time_stop',
  'magic_wall',
  'blink_slash',
  'mine',
  'turret',
  'familiar',
  'barrier_field',
  'stake',
  'missile_swarm',
  'decoy',
  'barrel',
  'drone',
  'floating_swords',
  'shield_knight',
  'parry',
  'reflector',
  'evasive_strike',
  'drain',
  'riposte_stance',
  'iron_wall',
  'taunt',
  'bulwark_charge',
  'deflect_slash',
  'dash_slash',
  'air_combo',
  'dive',
  'glide_shot',
  'wall_kick',
  'sliding',
  'skate',
  'wall_jump_strike',
  'jump_slash',
  'sprint_ram',
  'sonic',
  'self_destruct',
  'roulette',
  'momentum',
  'yoyo',
  'giant_fist',
  'fishing_rod',
  'drum',
  'stamina_shot',
  'ultimate_charge',
];

describe('attackStyleCatalog', () => {
  it('F11 の 100 スタイルを同じ順で定義している', () => {
    expect(ATTACK_STYLES.map((s) => s.id)).toEqual(F11_IDS);
  });

  it('ID は重複しない', () => {
    expect(new Set(ATTACK_STYLES.map((s) => s.id)).size).toBe(100);
  });

  it('系統ごとに 10 スタイルある', () => {
    const counts = new Map<string, number>();
    for (const s of ATTACK_STYLES) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    expect([...counts.values()]).toEqual(Array.from({ length: 10 }, () => 10));
  });

  it('規模の内訳は S 21 / M 54 / L 25', () => {
    const count = (scale: string) => ATTACK_STYLES.filter((s) => s.scale === scale).length;
    expect([count('S'), count('M'), count('L')]).toEqual([21, 54, 25]);
  });

  it('ID は英小文字とアンダースコアのみ、名称と説明は空でない', () => {
    for (const s of ATTACK_STYLES) {
      expect(s.id).toMatch(/^[a-z_]+$/);
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it('melee の押下は F04 の通常攻撃、長押しは接近強攻撃と一致する', () => {
    const melee = findAttackStyle('melee');
    expect(melee?.press.kind).toBe('combo');
    if (melee?.press.kind !== 'combo') return;
    expect(melee.press.stages).toEqual(defaultConfig.combat.normalAttack);
    expect(melee.press.shape).toEqual({
      type: 'sphere',
      radius: defaultConfig.combat.hitSphereRadius,
      forward: defaultConfig.combat.hitSphereForward,
    });
    expect(melee.press.comboWindow).toBe(defaultConfig.combat.comboWindow);
    const strong = defaultConfig.combat.strongAttack;
    expect(melee.hold).toMatchObject({
      trigger: 'start',
      action: {
        kind: 'lunge',
        damage: strong.damage,
        startup: strong.startup,
        active: strong.active,
        total: strong.total,
        lungeSpeed: strong.lungeSpeed,
        lungeMaxTime: strong.lungeMaxTime,
        stopDistance: strong.lungeStopDistance,
        knockback: strong.knockbackSpeed,
        target: { halfAngleDeg: strong.targetHalfAngleDeg, range: strong.targetRange },
      },
    });
    expect(melee.cost.hold).toEqual({ type: 'stamina', amount: strong.staminaCost });
  });

  it('gun の押下は F04 の射撃、長押しはタメ打ちと一致する', () => {
    const gun = findAttackStyle('gun');
    const shoot = defaultConfig.combat.shoot;
    const charged = defaultConfig.combat.chargedShot;
    expect(gun?.press).toMatchObject({
      kind: 'hitscan',
      damage: shoot.damage,
      range: shoot.range,
      total: shoot.total,
      knockback: shoot.knockbackSpeed,
    });
    expect(gun?.hold).toMatchObject({
      trigger: 'release',
      action: {
        kind: 'charge',
        maxTime: charged.maxChargeTime,
        moveSpeed: charged.chargeMoveSpeed,
        scale: { damage: [charged.baseDamage, charged.baseDamage + charged.bonusDamage] },
        release: {
          kind: 'hitscan',
          range: charged.range,
          pierce: true,
          knockback: charged.knockbackSpeed,
        },
      },
    });
  });

  it('未知の ID は null、既定は melee', () => {
    expect(findAttackStyle('no_such_style')).toBeNull();
    expect(DEFAULT_ATTACK_STYLE_ID).toBe('melee');
    expect(defaultAttackStyle().id).toBe('melee');
  });

  it('すべてのスタイルは押下・長押しとも 1 つ以上の行動種別を持つ', () => {
    for (const s of ATTACK_STYLES) {
      expect(actionKinds(s.press).length, s.id).toBeGreaterThan(0);
      expect(actionKinds(s.hold.action).length, s.id).toBeGreaterThan(0);
      expect(styleActionKinds(s).length, s.id).toBeGreaterThan(0);
    }
  });

  it('ランダムのプールは実在する別のスタイルを指す', () => {
    const roulette = findAttackStyle('roulette');
    expect(roulette?.press.kind).toBe('random');
    if (roulette?.press.kind !== 'random') return;
    for (const id of roulette.press.pool) {
      expect(id).not.toBe('roulette');
      expect(findAttackStyle(id)).not.toBeNull();
    }
  });
});
