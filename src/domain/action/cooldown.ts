// クールダウン(F03)。残り秒とリング表示用の比率を扱う。
export interface Cooldown {
  readonly remaining: number;
  readonly duration: number;
}

export const READY_COOLDOWN: Cooldown = { remaining: 0, duration: 0 };

export function startCooldown(duration: number): Cooldown {
  return { remaining: duration, duration };
}

export function tickCooldown(c: Cooldown, dt: number): Cooldown {
  if (c.remaining <= 0) return c;
  return { ...c, remaining: Math.max(0, c.remaining - dt) };
}

export function isReady(c: Cooldown): boolean {
  return c.remaining <= 0;
}

/** リング表示用。準備完了で 0、開始直後で 1。 */
export function cooldownRatio(c: Cooldown): number {
  if (c.duration <= 0 || c.remaining <= 0) return 0;
  return c.remaining / c.duration;
}

/** 残り秒数の表示文字列。1 秒以上は切り上げの整数、1 秒未満は小数 1 桁。準備完了は空文字。 */
export function remainingSecondsLabel(c: Cooldown): string {
  if (c.remaining <= 0) return '';
  if (c.remaining >= 1) return String(Math.ceil(c.remaining));
  return (Math.ceil(c.remaining * 10) / 10).toFixed(1);
}
