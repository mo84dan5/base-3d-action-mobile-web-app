import type { ActionConfig } from '../config/gameConfig';

// エネルギー(F03)。通常攻撃のヒットで蓄積し、バースト発動で 0 に戻る(固定スキルは F12 で廃止)。
export interface Energy {
  readonly value: number;
  readonly max: number;
}

export type EnergyHitKind = 'normal' | 'air' | 'burst';

export function createEnergy(config: Pick<ActionConfig, 'energyMax'>): Energy {
  return { value: 0, max: config.energyMax };
}

export function gainEnergy(e: Energy, amount: number): Energy {
  return { ...e, value: Math.min(e.max, e.value + Math.max(0, amount)) };
}

export function spendEnergy(e: Energy, amount: number): Energy {
  return { ...e, value: Math.max(0, e.value - Math.max(0, amount)) };
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

/** ヒット 1 回あたりのエネルギー獲得量。通常攻撃(地上・空中)+5、バースト 0。 */
export function energyForHit(
  kind: EnergyHitKind,
  config: Pick<ActionConfig, 'energyPerNormalHit'>,
): number {
  switch (kind) {
    case 'normal':
    case 'air':
      return config.energyPerNormalHit;
    case 'burst':
      return 0;
  }
}
