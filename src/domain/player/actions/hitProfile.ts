import type { HitClass } from '../../attackStyle/actionSpec';
import type { HitProfile } from '../../combat/damage';
import type { AttackKind } from '../../hitReaction/hitTables';

// スタイル定義からヒットの性質(F10 の表の選択とノックバック・エネルギー)を組み立てる。

export function kindOf(hitClass: HitClass, override?: AttackKind): AttackKind {
  return override ?? hitClass;
}

export function profileOf(
  spec: {
    readonly knockback?: number;
    readonly energyPerHit?: number;
    readonly stunSeconds?: number;
    readonly heal?: number;
    readonly dot?: { readonly perSecond: number; readonly duration: number };
  },
  extra: Partial<HitProfile> = {},
): HitProfile {
  const profile: HitProfile = {
    knockbackSpeed: spec.knockback ?? 0,
    energyGain: spec.energyPerHit ?? 0,
    ...(spec.stunSeconds !== undefined ? { stunSeconds: spec.stunSeconds } : {}),
    ...(spec.heal !== undefined ? { heal: spec.heal } : {}),
    ...(spec.dot !== undefined ? { dot: spec.dot } : {}),
  };
  return { ...profile, ...extra };
}
