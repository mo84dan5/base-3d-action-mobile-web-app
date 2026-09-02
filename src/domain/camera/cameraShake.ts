import type { HitReactionConfig, ShakeSpec } from '../config/gameConfig';
import { FIXED_STEP_SECONDS } from '../config/gameConfig';

// カメラシェイク(F10)。位置オフセットのみで、ヨー・ピッチ・距離は変えない。ワールド時間(物理ステップ)で進む。

export interface CameraShake {
  readonly amplitude: number;
  readonly remainingSteps: number;
  readonly totalSteps: number;
  readonly phaseX: number;
  readonly phaseY: number;
}

export const NO_SHAKE: CameraShake = {
  amplitude: 0,
  remainingSteps: 0,
  totalSteps: 0,
  phaseX: 0,
  phaseY: 0,
};

/** 現在の残り振幅(線形減衰後の値)。 */
export function currentAmplitude(shake: CameraShake): number {
  if (shake.totalSteps <= 0 || shake.remainingSteps <= 0) return 0;
  return shake.amplitude * (shake.remainingSteps / shake.totalSteps);
}

/**
 * シェイク要求。新しい振幅が現在の残り振幅より大きければ置き換え、小さければ無視する(加算しない)。
 * 振幅は 0.2 m、持続は 30 ステップ(0.5 秒)を上限とする。
 */
export function requestShake(
  current: CameraShake,
  spec: ShakeSpec,
  rng: () => number,
  config: HitReactionConfig,
): CameraShake {
  const amplitude = Math.min(spec.amplitude, config.shakeMaxAmplitude);
  const steps = Math.min(spec.steps, config.shakeMaxSteps);
  if (amplitude <= 0 || steps <= 0) return current;
  if (amplitude <= currentAmplitude(current)) return current;
  return {
    amplitude,
    remainingSteps: steps,
    totalSteps: steps,
    phaseX: rng() * Math.PI * 2,
    phaseY: rng() * Math.PI * 2,
  };
}

/** ワールド時間を 1 ステップ進める。 */
export function tickShake(shake: CameraShake): CameraShake {
  if (shake.remainingSteps <= 0) return NO_SHAKE;
  const remainingSteps = shake.remainingSteps - 1;
  return remainingSteps <= 0 ? NO_SHAKE : { ...shake, remainingSteps };
}

export interface ShakeOffset {
  readonly x: number;
  readonly y: number;
}

/** カメラのローカル X(横)・Y(縦)のオフセット(m)。25 Hz の正弦波に線形減衰を掛ける。 */
export function shakeOffset(shake: CameraShake, config: HitReactionConfig): ShakeOffset {
  const amp = currentAmplitude(shake);
  if (amp === 0) return { x: 0, y: 0 };
  const elapsedSteps = shake.totalSteps - shake.remainingSteps;
  const t = elapsedSteps * FIXED_STEP_SECONDS;
  const omega = Math.PI * 2 * config.shakeFrequencyHz;
  return {
    x: amp * Math.sin(omega * t + shake.phaseX),
    y: amp * Math.sin(omega * t + shake.phaseY),
  };
}
