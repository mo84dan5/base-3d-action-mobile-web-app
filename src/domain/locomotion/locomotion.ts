// 移動タイプ(F12 脚スロットと移動タイプ)。脚スロットに設定する移動の種別。
// 本バージョンで実装するのは二足のみ。他は選択・保存できるが見た目・挙動は二足と同じ。

export type LocomotionType = 'biped' | 'multiLeg' | 'vehicle' | 'tank' | 'hover' | 'flight';

export interface LocomotionDefinition {
  readonly id: LocomotionType;
  readonly name: string;
  readonly description: string;
  readonly implemented: boolean;
}

/** 表示順(S05 脚タブの一覧) */
export const LOCOMOTION_TYPES: readonly LocomotionDefinition[] = [
  {
    id: 'biped',
    name: '二足',
    description: '2 本の脚で歩く。移動速度に応じて脚が交互に振れる。',
    implemented: true,
  },
  {
    id: 'multiLeg',
    name: '多足',
    description: '4 本以上の脚で歩く(想定)。',
    implemented: false,
  },
  {
    id: 'vehicle',
    name: '車両',
    description: '車輪で走る(想定)。',
    implemented: false,
  },
  {
    id: 'tank',
    name: '戦車',
    description: '履帯で進む(想定)。',
    implemented: false,
  },
  {
    id: 'hover',
    name: '浮遊',
    description: '接地せずに浮いて移動する(想定)。',
    implemented: false,
  },
  {
    id: 'flight',
    name: '飛行',
    description: '翼で飛ぶ(想定)。',
    implemented: false,
  },
];

export const DEFAULT_LOCOMOTION: LocomotionType = 'biped';

export function findLocomotion(id: string): LocomotionDefinition | null {
  return LOCOMOTION_TYPES.find((t) => t.id === id) ?? null;
}

export function isLocomotionType(value: unknown): value is LocomotionType {
  return typeof value === 'string' && findLocomotion(value) !== null;
}

/** 保存データから移動タイプを復元する(F06)。未知の値は二足へ戻す。未実装のタイプは保持する */
export function readLocomotion(value: unknown): LocomotionType {
  return isLocomotionType(value) ? value : DEFAULT_LOCOMOTION;
}

/** 見た目・挙動に使う移動タイプ。未実装のタイプは二足として扱う(F12) */
export function effectiveLocomotion(id: LocomotionType): LocomotionType {
  return findLocomotion(id)?.implemented ? id : DEFAULT_LOCOMOTION;
}
