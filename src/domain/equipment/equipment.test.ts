import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EQUIPMENT,
  EQUIPMENT_SLOTS,
  SLOT_PRIORITY,
  readEquipment,
  shortStyleName,
  withSlot,
  ASSEMBLY_SLOTS,
  ASSEMBLY_SLOT_LABELS,
  isEquipmentSlot,
} from './equipment';

describe('readEquipment(F06 / F12)', () => {
  it('equipment があればスロットごとに読み、未知の ID はそのスロットの既定に戻す', () => {
    const e = readEquipment({ head: 'rifle', rightArm: 'nope', leftArm: 'bow' }, 'gun');
    expect(e).toEqual({ head: 'rifle', rightArm: 'melee', leftArm: 'bow' });
  });
  it('equipment が無く attackStyle だけの旧データは右腕へ移行し、左腕・頭は既定', () => {
    expect(readEquipment(undefined, 'gun')).toEqual({ ...DEFAULT_EQUIPMENT, rightArm: 'gun' });
  });
  it('どちらも無ければ既定(頭 laser / 右腕 melee / 左腕 shockwave)', () => {
    expect(readEquipment(undefined, undefined)).toEqual(DEFAULT_EQUIPMENT);
    expect(readEquipment(null, 42)).toEqual(DEFAULT_EQUIPMENT);
  });
  it('withSlot は他のスロットを変えない', () => {
    expect(withSlot(DEFAULT_EQUIPMENT, 'head', 'bow')).toEqual({
      ...DEFAULT_EQUIPMENT,
      head: 'bow',
    });
  });
  it('スロットの表示順は 頭・右腕・左腕、同時押しの優先は 頭 > 左腕 > 右腕', () => {
    expect(EQUIPMENT_SLOTS).toEqual(['head', 'rightArm', 'leftArm']);
    expect(SLOT_PRIORITY).toEqual(['head', 'leftArm', 'rightArm']);
  });
  it('略称は先頭 3 文字(サロゲートペアも 1 文字として数える)', () => {
    expect(shortStyleName('格闘')).toBe('格闘');
    expect(shortStyleName('スナイパー')).toBe('スナイ');
    expect(shortStyleName('レーザー')).toBe('レーザ');
  });
});

describe('組み替えスロット(S05 / F12 脚スロット)', () => {
  it('頭・右腕・左腕・脚の順で、脚は技のスロットではない', () => {
    expect(ASSEMBLY_SLOTS).toEqual(['head', 'rightArm', 'leftArm', 'legs']);
    expect(ASSEMBLY_SLOT_LABELS.legs).toBe('脚');
    expect(isEquipmentSlot('legs')).toBe(false);
  });
});
