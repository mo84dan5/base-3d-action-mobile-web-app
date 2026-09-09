import { describe, expect, it } from 'vitest';
import { ATTACK_STYLES } from '../../domain/attackStyle/attackStyleCatalog';
import { meleeVisualOf, projectileVisualOf, shotVisualOf } from './weaponVisual';

// 武器別の言語(デザインディレクション エフェクト)の対応表。

describe('shotVisualOf', () => {
  it('弓・ライフル・ガトリング・ビームは別の型になる', () => {
    expect(shotVisualOf('bow')).toBe('arrow');
    expect(shotVisualOf('rifle')).toBe('precise');
    expect(shotVisualOf('gatling')).toBe('rapid');
    expect(shotVisualOf('laser')).toBe('beam');
    expect(
      new Set([
        shotVisualOf('bow'),
        shotVisualOf('rifle'),
        shotVisualOf('gatling'),
        shotVisualOf('laser'),
      ]).size,
    ).toBe(4);
  });
  it('未知・null は弾', () => {
    expect(shotVisualOf(null)).toBe('bullet');
    expect(shotVisualOf('turret')).toBe('bullet');
    expect(shotVisualOf('constructor')).toBe('bullet');
  });
  it('ヒットスキャンを持つ 100 案のスタイルはすべて型を持つ(既定の弾を含む)', () => {
    for (const s of ATTACK_STYLES) expect(typeof shotVisualOf(s.id)).toBe('string');
  });
});

describe('meleeVisualOf', () => {
  it('槍・棍棒・拳・薙ぎ・槌はそれぞれの型', () => {
    expect(meleeVisualOf('spear')).toBe('spear');
    expect(meleeVisualOf('staff')).toBe('staff');
    expect(meleeVisualOf('boxer')).toBe('fist');
    expect(meleeVisualOf('naginata')).toBe('sweep');
    expect(meleeVisualOf('warhammer')).toBe('hammer');
  });
  it('個別指定のない特殊は衝撃、長柄は槍、魔法風は魔法、剣術は斬撃', () => {
    expect(meleeVisualOf('self_destruct')).toBe('impact');
    expect(meleeVisualOf('halberd')).toBe('sweep');
    expect(meleeVisualOf('melee')).toBe('slash');
    expect(meleeVisualOf('magic_bolt')).toBe('magic');
    expect(meleeVisualOf(null)).toBe('slash');
  });
});

describe('projectileVisualOf', () => {
  it('ブーメランは V 字、手裏剣は十字、投槍は槍、既定は四面体', () => {
    expect(projectileVisualOf('boomerang')).toBe('boomerang');
    expect(projectileVisualOf('shuriken')).toBe('shuriken');
    expect(projectileVisualOf('javelin')).toBe('javelin');
    expect(projectileVisualOf('unknown')).toBe('tetra');
  });
});
