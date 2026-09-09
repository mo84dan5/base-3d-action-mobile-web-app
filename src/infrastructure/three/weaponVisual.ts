import type { StyleCategory } from '../../domain/attackStyle/actionSpec';
import { findAttackStyle } from '../../domain/attackStyle/attackStyleCatalog';

// 武器別の言語(デザインディレクション エフェクト)。スタイル ID を「武器の型」に対応付ける 1 か所。
// 系統の色は変えず、動きの中のシルエット(形・動き・持続)を型ごとに分ける。

/** 射線(ヒットスキャン)の武器型 */
export type ShotVisual =
  'bullet' | 'precise' | 'pellet' | 'rapid' | 'beam' | 'arrow' | 'needle' | 'dart' | 'stamina';

/** 近接の武器型 */
export type MeleeVisual =
  'slash' | 'fist' | 'hammer' | 'staff' | 'spear' | 'sweep' | 'impact' | 'magic';

/** 発射体(N1)の形 */
export type ProjectileVisual =
  | 'tetra'
  | 'wave'
  | 'boomerang'
  | 'shuriken'
  | 'chakram'
  | 'knife'
  | 'javelin'
  | 'bomb'
  | 'stone'
  | 'rocket'
  | 'bolt'
  | 'yoyo'
  | 'hook';

const SHOT: Readonly<Record<string, ShotVisual>> = {
  gun: 'bullet',
  revolver: 'bullet',
  dual_pistol: 'bullet',
  glide_shot: 'bullet',
  rifle: 'precise',
  sniper: 'precise',
  shotgun: 'pellet',
  smg: 'rapid',
  gatling: 'rapid',
  laser: 'beam',
  beam: 'beam',
  bow: 'arrow',
  crossbow: 'arrow',
  needle: 'needle',
  dart: 'dart',
  stamina_shot: 'stamina',
};

const MELEE: Readonly<Record<string, MeleeVisual>> = {
  boxer: 'fist',
  palm: 'fist',
  rapid_fist: 'fist',
  kicker: 'fist',
  grappler: 'fist',
  warhammer: 'hammer',
  ground_slam: 'hammer',
  iron_shoulder: 'hammer',
  shield_bash: 'hammer',
  staff: 'staff',
  spear: 'spear',
  lance: 'spear',
  twin_spear: 'spear',
  skewer: 'spear',
  javelin: 'spear',
  pole_vault: 'spear',
  rapier: 'spear',
  naginata: 'sweep',
  whirlwind: 'sweep',
  scythe: 'sweep',
  halberd: 'sweep',
};

const PROJECTILE: Readonly<Record<string, ProjectileVisual>> = {
  sword_wave: 'wave',
  boomerang: 'boomerang',
  shuriken: 'shuriken',
  chakram: 'chakram',
  throwing_knife: 'knife',
  javelin: 'javelin',
  bomb: 'bomb',
  sling: 'stone',
  rocket: 'rocket',
  missile_swarm: 'rocket',
  magic_bolt: 'bolt',
  magic_cannon: 'bolt',
  yoyo: 'yoyo',
  fishing_rod: 'hook',
};

const MELEE_BY_CATEGORY: Readonly<Partial<Record<StyleCategory, MeleeVisual>>> = {
  strike: 'impact',
  special: 'impact',
  polearm: 'spear',
  magic: 'magic',
};

function lookup<T extends string>(table: Readonly<Record<string, T>>, id: string): T | null {
  return Object.hasOwn(table, id) ? (table[id] ?? null) : null;
}

export function shotVisualOf(styleId: string | null | undefined): ShotVisual {
  if (!styleId) return 'bullet';
  return lookup(SHOT, styleId) ?? 'bullet';
}

export function meleeVisualOf(styleId: string | null | undefined): MeleeVisual {
  if (!styleId) return 'slash';
  const direct = lookup(MELEE, styleId);
  if (direct) return direct;
  const category = findAttackStyle(styleId)?.category;
  return (category && MELEE_BY_CATEGORY[category]) ?? 'slash';
}

export function projectileVisualOf(styleId: string): ProjectileVisual {
  return lookup(PROJECTILE, styleId) ?? 'tetra';
}
