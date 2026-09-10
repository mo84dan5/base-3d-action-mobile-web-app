import { findAttackStyle } from '../attackStyle/attackStyleCatalog';

// 装備スロット(F12)。頭・右腕・左腕に F11 のスタイルを 1 つずつ装備し、スロットごとに技を持つ。

export type EquipmentSlot = 'head' | 'rightArm' | 'leftArm';

/** 技のスロットの表示順(HUD の補助表示・S05 のスロットタブ) */
export const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = ['head', 'rightArm', 'leftArm'];

export const SLOT_LABELS: Readonly<Record<EquipmentSlot, string>> = {
  head: '頭',
  rightArm: '右腕',
  leftArm: '左腕',
};

/** 同一フレームで複数のスロットの入力が成立したときの優先順(F03: 頭 > 左腕 > 右腕) */
export const SLOT_PRIORITY: readonly EquipmentSlot[] = ['head', 'leftArm', 'rightArm'];

export type Equipment = Readonly<Record<EquipmentSlot, string>>;

/**
 * S05 装備組み替えのスロット。技のスロット(頭・右腕・左腕)に脚を加えたもの。
 * 脚は攻撃スタイルではなく移動タイプ(F12)を選ぶため `EquipmentSlot` には含めない。
 */
export type AssemblySlot = EquipmentSlot | 'legs';

/** 表示順(S05 のスロットタブ) */
export const ASSEMBLY_SLOTS: readonly AssemblySlot[] = ['head', 'rightArm', 'leftArm', 'legs'];

export const ASSEMBLY_SLOT_LABELS: Readonly<Record<AssemblySlot, string>> = {
  ...SLOT_LABELS,
  legs: '脚',
};

export const DEFAULT_EQUIPMENT: Equipment = {
  head: 'laser',
  rightArm: 'melee',
  leftArm: 'shockwave',
};

export function isEquipmentSlot(value: unknown): value is EquipmentSlot {
  return value === 'head' || value === 'rightArm' || value === 'leftArm';
}

function knownStyleOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && findAttackStyle(value) !== null ? value : fallback;
}

/**
 * 保存データから装備を復元する(F06)。
 * - `equipment` があればスロットごとに検証し、未知の ID はそのスロットの既定へ戻す
 * - 無ければ旧キー `attackStyle` を右腕に移行する(左腕・頭は既定)
 */
export function readEquipment(equipment: unknown, legacyAttackStyle: unknown): Equipment {
  if (typeof equipment === 'object' && equipment !== null && !Array.isArray(equipment)) {
    const e = equipment as Record<string, unknown>;
    return {
      head: knownStyleOr(e.head, DEFAULT_EQUIPMENT.head),
      rightArm: knownStyleOr(e.rightArm, DEFAULT_EQUIPMENT.rightArm),
      leftArm: knownStyleOr(e.leftArm, DEFAULT_EQUIPMENT.leftArm),
    };
  }
  return {
    ...DEFAULT_EQUIPMENT,
    rightArm: knownStyleOr(legacyAttackStyle, DEFAULT_EQUIPMENT.rightArm),
  };
}

export function withSlot(equipment: Equipment, slot: EquipmentSlot, styleId: string): Equipment {
  return { ...equipment, [slot]: styleId };
}

/** HUD の技ボタンに出す略称(先頭 3 文字。S02) */
export function shortStyleName(name: string): string {
  return Array.from(name).slice(0, 3).join('');
}
