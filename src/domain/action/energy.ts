import type { ActionConfig } from '../config/gameConfig';

// エネルギー(F03)。通常攻撃・スキルのヒットで蓄積し、バースト発動で 0 に戻る。
export interface Energy {
  readonly value: number;
  readonly max: number;
}

export type EnergyHitKind = 'normal' | 'air' | 'skill' | 'burst';

export function createEnergy(config: Pick<ActionConfig, 'energyMax'>): Energy {
  return { value: 0, max: config.energyMax };
}

export function gainEnergy(e: Energy, amount: number): Energy {
  return { ...e, value: Math.min(e.max, e.value + Math.max(0, amount)) };
}

export function spendAllEnergy(e: Energy): Energy {
  return { ...e, value: 0 };
}

export function isEnergyFull(e: Energy): boolean {
  return e.value >= e.max;
}

export function energyRatio(e: Energy): number {
  return e.max <= 0 ? 0 : e.value / e.max;
}

/** ヒット 1 回あたりのエネルギー獲得量。通常攻撃(地上・空中)+5、スキル +15、バースト 0。 */
export function energyForHit(
  kind: EnergyHitKind,
  config: Pick<ActionConfig, 'energyPerNormalHit' | 'energyPerSkillHit'>,
): number {
  switch (kind) {
    case 'normal':
    case 'air':
      return config.energyPerNormalHit;
    case 'skill':
      return config.energyPerSkillHit;
    case 'burst':
      return 0;
  }
}
