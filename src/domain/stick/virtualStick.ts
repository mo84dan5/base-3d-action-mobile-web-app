import type { MovementConfig, StickConfig } from '../config/gameConfig';
import { type Vec2, length2, sub2 } from '../math/vec2';
import { type Vec3, UP, ZERO3, add, cross, directionFromYaw, scale } from '../math/vec3';

// バーチャルスティック(F01)。スクリーン座標(y は下向きに増える)を入力に変換する。

export interface StickInput {
  /** 単位方向の x(右が正) */
  readonly x: number;
  /** 単位方向の y(前 = 画面上が正) */
  readonly y: number;
  /** 0.0〜1.0 */
  readonly magnitude: number;
}

export const NO_STICK_INPUT: StickInput = { x: 0, y: 0, magnitude: 0 };

/**
 * 中心とポインタ位置から入力を求める。
 * 大きさはデッドゾーン境界(外円半径の 15%)で 0、外円で 1.0 になるよう線形補間する。
 */
export function computeStickInput(center: Vec2, pointer: Vec2, config: StickConfig): StickInput {
  const delta = sub2(pointer, center);
  const dist = length2(delta);
  const deadZone = config.outerRadiusPx * config.deadZoneRatio;
  if (dist <= deadZone) return NO_STICK_INPUT;
  const t = (dist - deadZone) / (config.outerRadiusPx - deadZone);
  return { x: delta.x / dist, y: -delta.y / dist, magnitude: Math.min(1, t) };
}

/** ノブ(内円)の位置。外円半径で制限する。 */
export function knobPosition(center: Vec2, pointer: Vec2, outerRadius: number): Vec2 {
  const delta = sub2(pointer, center);
  const dist = length2(delta);
  if (dist <= outerRadius) return pointer;
  const k = outerRadius / dist;
  return { x: center.x + delta.x * k, y: center.y + delta.y * k };
}

/** 固定モードでは外円半径の 1.5 倍以内で開始したタッチのみスティック操作とする。 */
export function canStartFixedStick(center: Vec2, pointer: Vec2, config: StickConfig): boolean {
  return length2(sub2(pointer, center)) <= config.outerRadiusPx * config.fixedStartRangeRatio;
}

/** 大きさ 0.6 以上で走り。 */
export function isRunMagnitude(magnitude: number, config: StickConfig): boolean {
  return magnitude >= config.runThreshold;
}

/**
 * カメラ基準の世界方向(水平)。スティック前 = カメラ前方の水平投影 = directionFromYaw(cameraYaw)。
 * 右手系・y 上では right = cross(forward, UP) となり、yaw 0(forward = +z)のとき right = (−1, 0, 0)。
 * したがってスティック右(x = +1)は世界の −x へ向かう。cameraYaw は「カメラからプレイヤーへ向かう水平方向」の角。
 * 返り値の長さは magnitude(入力 0 なら零ベクトル)。
 */
export function stickToWorldDirection(input: StickInput, cameraYaw: number): Vec3 {
  if (input.magnitude === 0) return ZERO3;
  const forward = directionFromYaw(cameraYaw);
  const right = cross(forward, UP);
  return scale(add(scale(forward, input.y), scale(right, input.x)), input.magnitude);
}

export interface KeyboardMoveKeys {
  readonly w: boolean;
  readonly a: boolean;
  readonly s: boolean;
  readonly d: boolean;
}

/** WASD の 8 方向入力。大きさ 1.0(走り)、walk = true(Ctrl)で 0.5(歩き)。 */
export function keyboardStick(keys: KeyboardMoveKeys, walk: boolean): StickInput {
  const x = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  const y = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
  if (x === 0 && y === 0) return NO_STICK_INPUT;
  const len = Math.hypot(x, y);
  return { x: x / len, y: y / len, magnitude: walk ? 0.5 : 1.0 };
}

/** 歩き / 走りの判定に使う移動速度(補助)。 */
export function targetSpeedFor(
  magnitude: number,
  stick: StickConfig,
  movement: MovementConfig,
): number {
  if (magnitude === 0) return 0;
  return isRunMagnitude(magnitude, stick) ? movement.runSpeed : movement.walkSpeed;
}
