import { type CameraConfig, degToRad } from '../config/gameConfig';
import {
  type Vec3,
  clamp,
  directionFromYaw,
  lerp,
  moveTowards,
  scale,
  sub,
  add,
} from '../math/vec3';
import type { Settings } from '../settings/settings';

// 三人称カメラの軌道計算(F02)。ヨー・ピッチ・距離を持ち、ユーザー操作でのみ回転する(自動で回り込まない)。
//
// 座標規約:
// - yaw(ラジアン)はカメラからプレイヤーへ向かう水平方向 forward = directionFromYaw(yaw) の角。
//   プレイヤーの正面 playerYaw の後方に置くには yaw = playerYaw とする。
// - pitchDeg は正が俯瞰(カメラが上から見下ろす)、負が見上げ。
// - 画面の右は right = cross(forward, UP)。yaw を増やすと forward は左へ回るため、右ドラッグは yaw を減らす。

export interface CameraOrbit {
  readonly yaw: number;
  readonly pitchDeg: number;
  readonly distance: number;
}

export interface PitchLimits {
  readonly minDeg: number;
  readonly maxDeg: number;
}

export function createCameraOrbit(playerYaw: number, config: CameraConfig): CameraOrbit {
  return { yaw: playerYaw, pitchDeg: config.defaultPitchDeg, distance: config.defaultDistance };
}

export function pitchLimitsFor(state: 'normal' | 'climb', config: CameraConfig): PitchLimits {
  return {
    minDeg: state === 'climb' ? config.climbMinPitchDeg : config.minPitchDeg,
    maxDeg: config.maxPitchDeg,
  };
}

/**
 * ドラッグ量(CSS px)を回転に変換する。感度 × 0.25 度/px。
 * 右ドラッグ(dx > 0)で視点が右を向く(yaw 減少)。上ドラッグ(dy < 0)で見上げる(pitch 減少)。
 * 設定の左右反転は dx を、上下反転は dy を反転する。
 */
export function applyLook(
  orbit: CameraOrbit,
  dx: number,
  dy: number,
  settings: Pick<Settings, 'cameraSensitivity' | 'invertCameraX' | 'invertCameraY'>,
  config: CameraConfig,
  limits: PitchLimits = pitchLimitsFor('normal', config),
): CameraOrbit {
  const degPerPx = config.degreesPerPx * settings.cameraSensitivity;
  const sx = settings.invertCameraX ? -1 : 1;
  const sy = settings.invertCameraY ? -1 : 1;
  return {
    ...orbit,
    yaw: orbit.yaw - degToRad(dx * sx * degPerPx),
    pitchDeg: clamp(orbit.pitchDeg + dy * sy * degPerPx, limits.minDeg, limits.maxDeg),
  };
}

export function clampPitch(orbit: CameraOrbit, limits: PitchLimits): CameraOrbit {
  return { ...orbit, pitchDeg: clamp(orbit.pitchDeg, limits.minDeg, limits.maxDeg) };
}

/** 距離を deltaMeters だけ変え、2.0〜8.0 m にクランプする。 */
export function applyZoom(
  orbit: CameraOrbit,
  deltaMeters: number,
  config: CameraConfig,
): CameraOrbit {
  return {
    ...orbit,
    distance: clamp(orbit.distance + deltaMeters, config.minDistance, config.maxDistance),
  };
}

/** ピンチ: 指間距離の変化(px)を距離の変化(m)へ。100 px の拡大(指を広げる)で 1.0 m 近づく(負)。 */
export function pinchDeltaToZoom(pinchDistanceDeltaPx: number, config: CameraConfig): number {
  return -pinchDistanceDeltaPx / config.pinchPxPerMeter;
}

/** ホイール: 1 ノッチで 0.5 m。正のノッチ(手前へ回す)で遠ざかる。 */
export function wheelToZoom(notches: number, config: CameraConfig): number {
  return notches * config.wheelMetersPerNotch;
}

/** 注視点 target から見た軌道上のカメラ位置。pitch 正でカメラが上(俯瞰)。 */
export function cameraPositionFor(target: Vec3, orbit: CameraOrbit, extraDistance = 0): Vec3 {
  const distance = orbit.distance + extraDistance;
  const pitch = degToRad(orbit.pitchDeg);
  const forward = directionFromYaw(orbit.yaw);
  const horizontal = scale(forward, -distance * Math.cos(pitch));
  return add(target, { x: horizontal.x, y: distance * Math.sin(pitch), z: horizontal.z });
}

export interface LookInertia {
  /** 慣性の速度(px/秒) */
  readonly vx: number;
  readonly vy: number;
  /** 慣性の残り秒 */
  readonly remaining: number;
}

export const NO_INERTIA: LookInertia = { vx: 0, vy: 0, remaining: 0 };

/** ドラッグ終了(LookEnd)時点の直前の移動量から慣性を開始する。 */
export function startInertia(
  lastDx: number,
  lastDy: number,
  dt: number,
  config: CameraConfig,
): LookInertia {
  if (dt <= 0) return NO_INERTIA;
  return { vx: lastDx / dt, vy: lastDy / dt, remaining: config.inertiaDecay };
}

/** 慣性を dt 進め、この間の移動量(px)と減衰後の慣性を返す。0.15 秒で線形に 0 へ。 */
export function decayInertia(
  inertia: LookInertia,
  dt: number,
  config: CameraConfig,
): { readonly inertia: LookInertia; readonly dx: number; readonly dy: number } {
  if (inertia.remaining <= 0) return { inertia: NO_INERTIA, dx: 0, dy: 0 };
  const step = Math.min(dt, inertia.remaining);
  const factor = inertia.remaining / config.inertiaDecay;
  const dx = inertia.vx * factor * step;
  const dy = inertia.vy * factor * step;
  const remaining = inertia.remaining - step;
  return {
    inertia: remaining <= 0 ? NO_INERTIA : { ...inertia, remaining },
    dx,
    dy,
  };
}

/** 注視点の追従。時定数 0.08 秒の指数平滑。 */
export function followTarget(current: Vec3, target: Vec3, dt: number, config: CameraConfig): Vec3 {
  const t = 1 - Math.exp(-dt / config.followTimeConstant);
  return lerp(current, target, t);
}

/** 障害物レイキャストの結果を距離に反映する。当たった点の手前 0.2 m に置く(下限 0.05 m)。 */
export function obstacleDistance(
  desiredDistance: number,
  hitDistance: number | null,
  config: CameraConfig,
): number {
  if (hitDistance === null) return desiredDistance;
  return Math.max(0.05, Math.min(desiredDistance, hitDistance - config.obstacleMargin));
}

/** 接近は即時、復帰(距離が伸びる)は 0.3 秒かけて補間する。 */
export function recoverDistance(
  current: number,
  desired: number,
  dt: number,
  config: CameraConfig,
): number {
  if (desired <= current) return desired;
  return moveTowards(current, desired, (config.maxDistance / config.obstacleRecoverTime) * dt);
}

/** カメラがプレイヤーに 1.0 m 以内まで近づいたらモデルを非表示にする。 */
export function shouldHidePlayer(distance: number, config: CameraConfig): boolean {
  return distance < config.hidePlayerDistance;
}

/**
 * 崖登り・滑空の出入りなど、値を transitionTime 秒かけて目標へ線形に近づける。
 * span は補間の開始時点の差(|目標 − 開始値|)。省略時は現在の差を使う(その場合は減速する近づき方になる)。
 */
export function blendTowards(
  current: number,
  target: number,
  dt: number,
  transitionTime: number,
  span: number = Math.abs(target - current),
): number {
  if (transitionTime <= 0 || span <= 0) return target;
  return moveTowards(current, target, (span / transitionTime) * dt);
}

/** 平地で見上げたときに地面との交差で縮む距離。target 高さ 1.4 m・pitch −30 度で約 2.6 m。 */
export function groundLimitedDistance(
  targetHeight: number,
  pitchDeg: number,
  config: CameraConfig,
): number {
  if (pitchDeg >= 0) return config.maxDistance;
  const sin = Math.sin(degToRad(-pitchDeg));
  return targetHeight / sin - config.obstacleMargin;
}

/** 注視点(ワールド)。プレイヤー足元 + (0, offsetY, 0)。 */
export function lookTarget(playerFeet: Vec3, offsetY: number): Vec3 {
  return { x: playerFeet.x, y: playerFeet.y + offsetY, z: playerFeet.z };
}

/** 注視点からカメラ位置までの方向と距離(障害物レイキャスト用)。 */
export function rayToCamera(
  target: Vec3,
  cameraPos: Vec3,
): { readonly dir: Vec3; readonly distance: number } {
  const d = sub(cameraPos, target);
  const len = Math.hypot(d.x, d.y, d.z);
  return { dir: len === 0 ? { x: 0, y: 0, z: 1 } : scale(d, 1 / len), distance: len };
}
