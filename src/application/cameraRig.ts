import {
  applyLook,
  applyZoom,
  blendTowards,
  cameraPositionFor,
  clampPitch,
  createCameraOrbit,
  decayInertia,
  followTarget,
  lookTarget,
  NO_INERTIA,
  obstacleDistance,
  pitchLimitsFor,
  rayToCamera,
  recoverDistance,
  shouldHidePlayer,
  startInertia,
  type CameraOrbit,
  type LookInertia,
} from '../domain/camera/cameraOrbit';
import {
  NO_SHAKE,
  requestShake,
  shakeOffset,
  tickShake,
  type CameraShake,
} from '../domain/camera/cameraShake';
import type { GameConfig, ShakeSpec } from '../domain/config/gameConfig';
import { UP, add, cross, normalize, scale, sub, type Vec3 } from '../domain/math/vec3';
import type { PlayerState } from '../domain/player/playerState';
import type { Settings } from '../domain/settings/settings';
import type { TerrainQuery } from '../domain/terrain/terrainQuery';
import type { RandomSource } from './ports';

// 三人称カメラの状態(F02)。軌道計算 → シェイク → 障害物レイキャスト → 最終位置 の順で更新する。

export interface CameraRigState {
  readonly orbit: CameraOrbit;
  readonly inertia: LookInertia;
  readonly lastLook: { readonly dx: number; readonly dy: number };
  readonly shake: CameraShake;
  /** 追従中の注視点 */
  readonly target: Vec3;
  /** 崖登り・滑空の補間中の注視点オフセット・ピッチ下限・距離加算 */
  readonly targetOffsetY: number;
  readonly minPitchDeg: number;
  readonly extraDistance: number;
  /** 障害物回避後の実距離 */
  readonly actualDistance: number;
  readonly position: Vec3;
  readonly lookAt: Vec3;
  readonly hidePlayer: boolean;
}

export interface CameraFrameInput {
  readonly lookDx: number;
  readonly lookDy: number;
  readonly lookEnded: boolean;
  readonly zoom: number;
}

export function createCameraRig(player: PlayerState, config: GameConfig): CameraRigState {
  const c = config.camera;
  const target = lookTarget(player.position, c.targetOffsetY);
  const orbit = createCameraOrbit(player.yaw, c);
  const position = cameraPositionFor(target, orbit);
  return {
    orbit,
    inertia: NO_INERTIA,
    lastLook: { dx: 0, dy: 0 },
    shake: NO_SHAKE,
    target,
    targetOffsetY: c.targetOffsetY,
    minPitchDeg: c.minPitchDeg,
    extraDistance: 0,
    actualDistance: c.defaultDistance,
    position,
    lookAt: target,
    hidePlayer: false,
  };
}

/** 向き切替・一時停止時: ドラッグ・ピンチを終了し慣性を即時 0 にする。 */
export function cancelCameraInput(rig: CameraRigState): CameraRigState {
  return { ...rig, inertia: NO_INERTIA, lastLook: { dx: 0, dy: 0 } };
}

export function requestCameraShake(
  rig: CameraRigState,
  spec: ShakeSpec | null,
  rng: RandomSource,
  config: GameConfig,
): CameraRigState {
  if (!spec) return rig;
  return { ...rig, shake: requestShake(rig.shake, spec, rng, config.hitReaction) };
}

function stateTargets(player: PlayerState, config: GameConfig) {
  const c = config.camera;
  const climbing = player.name === 'climb';
  const gliding = player.name === 'glide';
  return {
    targetOffsetY: climbing ? c.climbTargetOffsetY : c.targetOffsetY,
    minPitchDeg: climbing ? c.climbMinPitchDeg : c.minPitchDeg,
    extraDistance: gliding ? c.glideDistanceBonus : 0,
  };
}

/** 1 物理ステップぶんカメラを更新する(ワールド時間で進む。ヒットストップの影響を受けない)。 */
export function updateCameraRig(
  rig: CameraRigState,
  player: PlayerState,
  input: CameraFrameInput,
  settings: Settings,
  terrain: TerrainQuery,
  dt: number,
  config: GameConfig,
): CameraRigState {
  const c = config.camera;
  const goals = stateTargets(player, config);
  const targetOffsetY = blendTowards(
    rig.targetOffsetY,
    goals.targetOffsetY,
    dt,
    c.stateTransitionTime,
    Math.abs(c.targetOffsetY - c.climbTargetOffsetY),
  );
  const minPitchDeg = blendTowards(
    rig.minPitchDeg,
    goals.minPitchDeg,
    dt,
    c.stateTransitionTime,
    Math.abs(c.minPitchDeg - c.climbMinPitchDeg),
  );
  const extraDistance = blendTowards(
    rig.extraDistance,
    goals.extraDistance,
    dt,
    c.stateTransitionTime,
    c.glideDistanceBonus,
  );
  const limits = { minDeg: minPitchDeg, maxDeg: pitchLimitsFor('normal', c).maxDeg };

  let orbit = rig.orbit;
  let inertia = rig.inertia;
  let lastLook = rig.lastLook;
  const dragging = input.lookDx !== 0 || input.lookDy !== 0;
  if (dragging) {
    orbit = applyLook(orbit, input.lookDx, input.lookDy, settings, c, limits);
    lastLook = { dx: input.lookDx, dy: input.lookDy };
    inertia = NO_INERTIA;
  }
  if (input.lookEnded) {
    inertia = startInertia(lastLook.dx, lastLook.dy, dt, c);
    lastLook = { dx: 0, dy: 0 };
  }
  if (!dragging && inertia.remaining > 0) {
    const decayed = decayInertia(inertia, dt, c);
    inertia = decayed.inertia;
    orbit = applyLook(orbit, decayed.dx, decayed.dy, settings, c, limits);
  }
  orbit = clampPitch(orbit, limits);
  if (input.zoom !== 0) orbit = applyZoom(orbit, input.zoom, c);

  const target = followTarget(rig.target, lookTarget(player.position, targetOffsetY), dt, c);
  const desired = cameraPositionFor(target, orbit, extraDistance);
  const shake = tickShake(rig.shake);
  const offset = shakeOffset(shake, config.hitReaction);
  const forward = normalize(sub(target, desired));
  const right = normalize(cross(forward, UP));
  const up = cross(right, forward);
  const shaken = add(add(desired, scale(right, offset.x)), scale(up, offset.y));

  const ray = rayToCamera(target, shaken);
  const hit = terrain.raycast(target, ray.dir, ray.distance);
  const limited = obstacleDistance(ray.distance, hit ? hit.distance : null, c);
  const actualDistance = recoverDistance(rig.actualDistance, limited, dt, c);
  const position = add(target, scale(ray.dir, actualDistance));
  return {
    orbit,
    inertia,
    lastLook,
    shake,
    target,
    targetOffsetY,
    minPitchDeg,
    extraDistance,
    actualDistance,
    position,
    lookAt: target,
    hidePlayer: shouldHidePlayer(actualDistance, c),
  };
}
