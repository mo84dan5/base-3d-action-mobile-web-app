import { describe, expect, it } from 'vitest';
import { DEFAULT_EQUIPMENT } from '../domain/equipment/equipment';
import { previewStateOf, slotValueLabel } from './equipmentModal';

// DOM に依存しない純粋関数のみをテストする(モーダル本体は E2E で確認)

describe('S05 装備組み替え: スロットタブの装備名', () => {
  it('頭 / 腕はスタイル名、脚は移動タイプ名。未知のスタイル ID はそのまま出す', () => {
    expect(slotValueLabel('rightArm', DEFAULT_EQUIPMENT, 'biped')).toBe('格闘');
    expect(slotValueLabel('head', DEFAULT_EQUIPMENT, 'biped')).toBe('レーザー');
    expect(slotValueLabel('legs', DEFAULT_EQUIPMENT, 'hover')).toBe('浮遊');
    expect(slotValueLabel('leftArm', { ...DEFAULT_EQUIPMENT, leftArm: 'nope' }, 'biped')).toBe(
      'nope',
    );
  });
});

describe('S05 装備組み替え: プレビューへ渡す見た目', () => {
  it('スロットごとの系統と移動タイプ。未知のスタイルは剣術扱い', () => {
    expect(previewStateOf(DEFAULT_EQUIPMENT, 'biped')).toEqual({
      categories: { head: 'firearm', rightArm: 'sword', leftArm: 'magic' },
      locomotion: 'biped',
    });
    expect(previewStateOf({ ...DEFAULT_EQUIPMENT, head: 'nope' }, 'tank').categories.head).toBe(
      'sword',
    );
  });
});
