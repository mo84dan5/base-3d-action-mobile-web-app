// 撃破・敗北判定と統計(F04 / S04)。
export type GameResult = 'victory' | 'defeat';

export interface ResultEnemyView {
  readonly isDefeatTarget: boolean;
  readonly defeated: boolean;
}

/** 同一ステップで勝利と敗北が同時に成立した場合は敗北を優先する。 */
export function evaluateResult(
  playerHp: number,
  enemies: readonly ResultEnemyView[],
): GameResult | null {
  if (playerHp <= 0) return 'defeat';
  const targets = enemies.filter((e) => e.isDefeatTarget);
  if (targets.length > 0 && targets.every((e) => e.defeated)) return 'victory';
  return null;
}

export interface Stats {
  /** 開始カウントダウン終了からの経過秒(物理更新の累積) */
  readonly clearTime: number;
  readonly defeated: number;
  readonly totalTargets: number;
  readonly damageTaken: number;
  /** 結果条件の成立後は集計を凍結する */
  readonly frozen: boolean;
}

export function createStats(enemies: readonly ResultEnemyView[]): Stats {
  return {
    clearTime: 0,
    defeated: 0,
    totalTargets: enemies.filter((e) => e.isDefeatTarget).length,
    damageTaken: 0,
    frozen: false,
  };
}

export function recordDamageTaken(stats: Stats, amount: number): Stats {
  if (stats.frozen) return stats;
  return { ...stats, damageTaken: stats.damageTaken + amount };
}

export function recordDefeat(stats: Stats): Stats {
  if (stats.frozen) return stats;
  return { ...stats, defeated: stats.defeated + 1 };
}

export function tickClearTime(stats: Stats, dt: number): Stats {
  if (stats.frozen) return stats;
  return { ...stats, clearTime: Math.max(0, stats.clearTime + dt) };
}

export function freezeStats(stats: Stats): Stats {
  return { ...stats, frozen: true };
}

/** `mm:ss.ff` 形式。0 未満にならない。 */
export function formatClearTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const secs = Math.floor(total % 60);
  const hundredths = Math.floor((total - Math.floor(total)) * 100);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(minutes)}:${pad(secs)}.${pad(hundredths)}`;
}
