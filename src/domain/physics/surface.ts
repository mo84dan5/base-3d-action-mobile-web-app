import { degToRad, type PhysicsConfig } from '../config/gameConfig';
import { clamp } from '../math/vec3';

// 地形面の区分(F05)。法線の上向き成分(normalY)で判定する。
export type SurfaceKind = 'walkable' | 'slide' | 'wall' | 'ceiling';

export function walkableNormalY(config: PhysicsConfig): number {
  return Math.cos(degToRad(config.walkableMaxSlopeDeg));
}

export function wallNormalY(config: PhysicsConfig): number {
  return Math.cos(degToRad(config.wallMinSlopeDeg));
}

/**
 * 歩行可能面: 斜度 35 度以下(normalY ≥ 0.819)
 * 滑り面: 35 度超〜60 度未満(0.5 < normalY < 0.819)
 * 壁: 60 度以上(−0.1 ≤ normalY ≤ 0.5)
 * 天井: normalY < −0.1
 */
export function classifySurface(normalY: number, config: PhysicsConfig): SurfaceKind {
  if (normalY < config.ceilingNormalY) return 'ceiling';
  if (normalY >= walkableNormalY(config)) return 'walkable';
  if (normalY > wallNormalY(config)) return 'slide';
  return 'wall';
}

/** 重力を積分した鉛直速度(下向きは負)。終端速度でクランプする。 */
export function integrateGravity(vy: number, dt: number, config: PhysicsConfig): number {
  return clamp(vy - config.gravity * dt, -config.terminalVelocity, Infinity);
}

/** 接地中に自動で乗り越えられる段差か。 */
export function canStepUp(stepHeight: number, grounded: boolean, config: PhysicsConfig): boolean {
  return grounded && stepHeight > 0 && stepHeight <= config.stepOffset;
}

/** 滑り面での加速度(重力の斜面成分)。normalY は面の法線の上向き成分。 */
export function slideAcceleration(normalY: number, config: PhysicsConfig): number {
  const sinSlope = Math.sqrt(Math.max(0, 1 - normalY * normalY));
  return config.gravity * sinSlope;
}

/** 初速 v0 のジャンプの到達高。 */
export function jumpApexHeight(v0: number, config: PhysicsConfig): number {
  return (v0 * v0) / (2 * config.gravity);
}
