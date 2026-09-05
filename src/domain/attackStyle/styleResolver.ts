import type { ActionKind, AttackStyleDefinition } from './actionSpec';
import { actionKinds, styleActionKinds } from './actionSpec';
import { defaultAttackStyle, findAttackStyle } from './attackStyleCatalog';

// 設定 ID からスタイル定義を解決する(F04 / F06 / F11)。未知・未実装の ID は格闘へフォールバックする。

/** エンジンが実行できる行動種別。ここに無い種別を含むスタイルは未実装扱い */
export const IMPLEMENTED_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>([
  'combo',
  'lunge',
  'hitscan',
  'charge',
  'area',
  'multihit',
  'projectile',
  'placed',
  'summon',
  'guard',
  'movement',
  'buff',
  'selfEffect',
  'pull',
  'random',
]);

export function isStyleImplemented(style: AttackStyleDefinition): boolean {
  return styleActionKinds(style).every((k) => IMPLEMENTED_KINDS.has(k));
}

export function actionImplemented(kinds: readonly ActionKind[]): boolean {
  return kinds.every((k) => IMPLEMENTED_KINDS.has(k));
}

export interface ResolvedStyle {
  readonly style: AttackStyleDefinition;
  /** 設定の ID がそのまま使われたか(false は格闘へフォールバック) */
  readonly exact: boolean;
}

export function resolveAttackStyleDetailed(id: string): ResolvedStyle {
  const found = findAttackStyle(id);
  if (found && isStyleImplemented(found)) return { style: found, exact: true };
  return { style: defaultAttackStyle(), exact: false };
}

export function resolveAttackStyle(id: string): AttackStyleDefinition {
  return resolveAttackStyleDetailed(id).style;
}

export { actionKinds };
