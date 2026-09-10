import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCOMOTION,
  LOCOMOTION_TYPES,
  effectiveLocomotion,
  findLocomotion,
  isLocomotionType,
  readLocomotion,
} from './locomotion';

describe('移動タイプ(F12 脚スロットと移動タイプ)', () => {
  it('二足 / 多足 / 車両 / 戦車 / 浮遊 / 飛行 の 6 種で、二足だけが実装済み', () => {
    expect(LOCOMOTION_TYPES.map((t) => t.id)).toEqual([
      'biped',
      'multiLeg',
      'vehicle',
      'tank',
      'hover',
      'flight',
    ]);
    expect(LOCOMOTION_TYPES.filter((t) => t.implemented).map((t) => t.id)).toEqual(['biped']);
    expect(findLocomotion('biped')?.name).toBe('二足');
    expect(findLocomotion('flight')?.name).toBe('飛行');
  });
  it('既定は二足', () => {
    expect(DEFAULT_LOCOMOTION).toBe('biped');
  });
  it('readLocomotion: 未知の値・型違いは二足、未実装のタイプは保持する(F06)', () => {
    expect(readLocomotion(undefined)).toBe('biped');
    expect(readLocomotion('wheels')).toBe('biped');
    expect(readLocomotion(3)).toBe('biped');
    expect(readLocomotion('hover')).toBe('hover');
    expect(isLocomotionType('tank')).toBe(true);
    expect(isLocomotionType('')).toBe(false);
  });
  it('effectiveLocomotion: 未実装のタイプは二足として扱う', () => {
    expect(effectiveLocomotion('biped')).toBe('biped');
    expect(effectiveLocomotion('vehicle')).toBe('biped');
  });
});
