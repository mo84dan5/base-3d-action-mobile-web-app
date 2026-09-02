import type { StaminaConfig } from '../config/gameConfig';
import { clamp } from '../math/vec3';

// スタミナ(F01)。消費停止から regenDelay 秒後に接地中(Slide を除く)かつ消費行動をしていなければ回復する。
export interface StaminaState {
  readonly value: number;
  /** 回復が始まるまでの残り秒(消費のたびに regenDelay に戻る) */
  readonly regenDelayRemaining: number;
}

export function createStamina(config: StaminaConfig): StaminaState {
  return { value: config.max, regenDelayRemaining: 0 };
}

/** 一括消費(ダッシュ 18 など)。残量が不足していても 0 まで消費する(発動可否は呼び出し側が value > 0 で判定)。 */
export function consumeStamina(
  s: StaminaState,
  amount: number,
  config: StaminaConfig,
): StaminaState {
  return { value: clamp(s.value - amount, 0, config.max), regenDelayRemaining: config.regenDelay };
}

/** 継続消費(スプリント 15/秒 など)。 */
export function drainStamina(
  s: StaminaState,
  ratePerSecond: number,
  dt: number,
  config: StaminaConfig,
): StaminaState {
  return consumeStamina(s, ratePerSecond * dt, config);
}

/** 回復処理。canRegen が false(空中・Slide・消費中)の間は遅延タイマーも進めない。 */
export function regenerateStamina(
  s: StaminaState,
  dt: number,
  canRegen: boolean,
  config: StaminaConfig,
): StaminaState {
  if (!canRegen) return s;
  if (s.regenDelayRemaining > 0) {
    const remaining = s.regenDelayRemaining - dt;
    if (remaining > 0) return { ...s, regenDelayRemaining: remaining };
    // 遅延が今ステップ内で終わった分だけ回復する
    return {
      value: clamp(s.value + config.regenPerSecond * -remaining, 0, config.max),
      regenDelayRemaining: 0,
    };
  }
  return { ...s, value: clamp(s.value + config.regenPerSecond * dt, 0, config.max) };
}

export function isStaminaEmpty(s: StaminaState): boolean {
  return s.value <= 0;
}

export function isStaminaLow(s: StaminaState, config: StaminaConfig): boolean {
  return s.value <= config.max * config.lowRatio;
}
