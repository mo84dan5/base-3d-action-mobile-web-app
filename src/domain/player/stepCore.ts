import type { ActionSpec, CostSpec } from '../attackStyle/actionSpec';
import { degToRad, type GameConfig } from '../config/gameConfig';
import {
  ZERO3,
  directionFromYaw,
  horizontalLength,
  rotateTowards,
  scale,
  vec3,
  yawFromDirection,
  type Vec3,
} from '../math/vec3';
import { integrateGravity } from '../physics/surface';
import { consumeStamina, isStaminaEmpty, regenerateStamina } from '../stamina/stamina';
import type { TerrainQuery } from '../terrain/terrainQuery';
import type { PlayerEvent } from './playerEvents';
import type { PlayerStepInput } from './playerInput';
import {
  moveInAir,
  moveOnGround,
  moveVelocityTowards,
  playerCapsule,
  type MoveResult,
} from './playerPhysics';
import type { PlayerState, PlayerStateName } from './playerState';

// 状態更新の共通部品(F01 / F04 / F11)。各状態の更新関数とスタイル行動のエンジンが共有する。

export interface StartActionOptions {
  readonly source: 'press' | 'hold';
  /** 発動コスト(スタイルの押下 / 長押し)。連鎖(then)では省略 */
  readonly cost?: CostSpec;
  readonly chargeRatio?: number;
  readonly radiusScale?: number;
  readonly damageScale?: number;
  readonly then?: ActionSpec | null;
  /** allStamina で消費したスタミナ(スタミナ弾のダメージ計算用) */
  readonly staminaSpent?: number;
}

export interface Ctx {
  readonly input: PlayerStepInput;
  readonly terrain: TerrainQuery;
  readonly dt: number;
  readonly config: GameConfig;
  readonly events: PlayerEvent[];
  /** 世界座標の移動方向(長さ = 入力の大きさ) */
  readonly move: Vec3;
  readonly moveDir: Vec3;
  readonly magnitude: number;
  /** スタイル行動を開始する(エンジン同士の連鎖用に注入する)。開始できなければ null */
  readonly startAction: (
    p: PlayerState,
    ctx: Ctx,
    spec: ActionSpec,
    opts: StartActionOptions,
  ) => PlayerState | null;
  /** 現在のスタイルの押下 / 長押し行動を開始する(コスト込み) */
  readonly startPress: (p: PlayerState, ctx: Ctx) => PlayerState | null;
  readonly startHold: (p: PlayerState, ctx: Ctx) => PlayerState | null;
}

export function enter(p: PlayerState, name: PlayerStateName): PlayerState {
  return { ...p, name, stateTime: 0 };
}

export function locomotionFor(magnitude: number, config: GameConfig): PlayerStateName {
  if (magnitude === 0) return 'idle';
  return magnitude >= config.stick.runThreshold ? 'run' : 'walk';
}

export function groundSpeedFor(magnitude: number, config: GameConfig): number {
  if (magnitude === 0) return 0;
  return magnitude >= config.stick.runThreshold
    ? config.movement.runSpeed
    : config.movement.walkSpeed;
}

export function turnTowards(p: PlayerState, dir: Vec3, speedDeg: number, dt: number): PlayerState {
  if (dir.x === 0 && dir.z === 0) return p;
  return { ...p, yaw: rotateTowards(p.yaw, yawFromDirection(dir), degToRad(speedDeg) * dt) };
}

export function withStamina(p: PlayerState, ctx: Ctx, next: PlayerState['stamina']): PlayerState {
  if (!isStaminaEmpty(p.stamina) && isStaminaEmpty(next)) {
    ctx.events.push({ type: 'staminaDepleted' });
  }
  return { ...p, stamina: next };
}

export function regen(p: PlayerState, ctx: Ctx, canRegen: boolean): PlayerState {
  return { ...p, stamina: regenerateStamina(p.stamina, ctx.dt, canRegen, ctx.config.stamina) };
}

export function applyGround(p: PlayerState, r: MoveResult): PlayerState {
  return {
    ...p,
    position: r.position,
    velocity: r.velocity,
    grounded: r.ground.kind === 'walkable',
    groundNormal: r.ground.kind === 'none' ? p.groundNormal : r.ground.normal,
  };
}

/** 行動を終えて素の状態へ戻すときに消すフィールド。 */
export function clearAction(p: PlayerState): PlayerState {
  return { ...p, attack: null, strong: null, action: null, techniqueSlot: null };
}

export function startJump(
  p: PlayerState,
  ctx: Ctx,
  speed = ctx.config.movement.jumpSpeed,
): PlayerState {
  ctx.events.push({ type: 'jumped' });
  return {
    ...enter(clearAction(p), 'jump'),
    velocity: vec3(p.velocity.x, speed, p.velocity.z),
    grounded: false,
    coyoteRemaining: 0,
    jumpBufferRemaining: 0,
  };
}

export function startFall(p: PlayerState, ctx: Ctx, coyote: boolean): PlayerState {
  return {
    ...enter(clearAction(p), 'fall'),
    grounded: false,
    coyoteRemaining: coyote ? ctx.config.movement.coyoteTime : 0,
    climb: null,
  };
}

export function startDash(p: PlayerState, ctx: Ctx): PlayerState {
  const dir = ctx.magnitude > 0 ? ctx.moveDir : directionFromYaw(p.yaw);
  ctx.events.push({ type: 'dashStarted', direction: dir });
  return withStamina(
    {
      ...enter(clearAction(p), 'dash'),
      dashDirection: dir,
      velocity: scale(dir, ctx.config.movement.dashSpeed),
      yaw: yawFromDirection(dir),
    },
    ctx,
    consumeStamina(p.stamina, ctx.config.stamina.dashCost, ctx.config.stamina),
  );
}

export function enterSlide(p: PlayerState, ctx: Ctx): PlayerState {
  ctx.events.push({ type: 'slideStarted' });
  return { ...enter(clearAction(p), 'slide'), grounded: false };
}

export function nextGroundState(p: PlayerState, ctx: Ctx): PlayerStateName {
  if (p.sprintHeld && ctx.magnitude > 0 && !isStaminaEmpty(p.stamina)) return 'sprint';
  return locomotionFor(ctx.magnitude, ctx.config);
}

/** 着地。空中攻撃中は攻撃を継続する。 */
export function land(p: PlayerState, ctx: Ctx, r: MoveResult): PlayerState {
  ctx.events.push({ type: 'landed', fallSpeed: Math.max(0, -p.velocity.y) });
  if (p.name === 'glide') ctx.events.push({ type: 'glideEnded', reason: 'landed' });
  const landed: PlayerState = {
    ...applyGround(p, r),
    velocity: vec3(r.velocity.x, 0, r.velocity.z),
    airAttackUsed: false,
    airAttackCount: 0,
    climb: null,
    attack: p.name === 'airAttack' ? p.attack : null,
    action: p.name === 'airAttack' ? p.action : null,
  };
  if (p.name === 'airAttack') return landed;
  if (landed.jumpBufferRemaining > 0) return startJump(landed, ctx);
  return enter(landed, nextGroundState(landed, ctx));
}

/** 重力を積分する。位置の更新には前後の鉛直速度の平均を使う(到達高が解析値 1.225 m と一致する)。 */
export function applyGravity(v: Vec3, ctx: Ctx): { velocity: Vec3; moveVelocity: Vec3 } {
  const vy = integrateGravity(v.y, ctx.dt, ctx.config.physics);
  return { velocity: vec3(v.x, vy, v.z), moveVelocity: vec3(v.x, (v.y + vy) / 2, v.z) };
}

export function airControl(p: PlayerState, ctx: Ctx): PlayerState {
  const { config, dt } = ctx;
  if (ctx.magnitude === 0) return p;
  const current = horizontalLength(p.velocity);
  const speed = Math.min(
    config.movement.dashSpeed,
    Math.max(groundSpeedFor(ctx.magnitude, config), current),
  );
  const target = scale(ctx.moveDir, speed);
  const h = moveVelocityTowards(
    vec3(p.velocity.x, 0, p.velocity.z),
    target,
    config.movement.acceleration * config.movement.airControlRatio * dt,
  );
  return turnTowards(
    { ...p, velocity: vec3(h.x, p.velocity.y, h.z) },
    ctx.moveDir,
    config.movement.turnSpeedDeg,
    dt,
  );
}

export type GroundOutcome = 'ok' | 'fell' | 'slide';

/** 接地状態のまま velocity で 1 ステップ動かす。落下・滑りは outcome で返す(状態遷移は呼び出し側)。 */
export function moveGrounded(
  p: PlayerState,
  ctx: Ctx,
  velocity: Vec3,
): { next: PlayerState; outcome: GroundOutcome; walls: number } {
  const r = moveOnGround(
    p.position,
    velocity,
    ctx.dt,
    playerCapsule(ctx.config),
    ctx.terrain,
    ctx.config,
  );
  const next = { ...applyGround(p, r), velocity: ZERO3 };
  if (r.ground.kind === 'none') return { next, outcome: 'fell', walls: r.walls.length };
  if (r.ground.kind === 'slide') return { next, outcome: 'slide', walls: r.walls.length };
  return { next, outcome: 'ok', walls: r.walls.length };
}

export type AirOutcome = 'air' | 'landed' | 'slide';

/** 空中で重力を掛けて 1 ステップ動かす。着地は outcome で返す(状態遷移は呼び出し側)。 */
export function moveAirborne(
  p: PlayerState,
  ctx: Ctx,
): { next: PlayerState; outcome: AirOutcome; result: MoveResult } {
  const gravity = applyGravity(p.velocity, ctx);
  const r = moveInAir(
    p.position,
    gravity.moveVelocity,
    ctx.dt,
    playerCapsule(ctx.config),
    ctx.terrain,
    ctx.config,
  );
  let next: PlayerState = {
    ...applyGround(p, r),
    velocity: vec3(
      r.velocity.x,
      r.hitCeiling ? Math.min(0, gravity.velocity.y) : gravity.velocity.y,
      r.velocity.z,
    ),
  };
  if (r.ground.kind === 'walkable') {
    ctx.events.push({ type: 'landed', fallSpeed: Math.max(0, -p.velocity.y) });
    next = {
      ...next,
      velocity: vec3(r.velocity.x, 0, r.velocity.z),
      airAttackUsed: false,
      airAttackCount: 0,
    };
    return { next, outcome: 'landed', result: r };
  }
  if (r.ground.kind === 'slide') return { next, outcome: 'slide', result: r };
  return { next, outcome: 'air', result: r };
}

/** 行動の終了: 接地なら地上状態、空中なら落下へ。 */
export function finishAction(p: PlayerState, ctx: Ctx): PlayerState {
  const cleared = clearAction(p);
  if (cleared.grounded) return enter(cleared, nextGroundState(cleared, ctx));
  return startFall(cleared, ctx, false);
}

/** 静止して接地を保つ(攻撃の振り・タメなど)。 */
export function standStill(
  p: PlayerState,
  ctx: Ctx,
): { next: PlayerState; outcome: GroundOutcome } {
  const { next, outcome } = moveGrounded(p, ctx, ZERO3);
  return { next: outcome === 'ok' ? regen(next, ctx, true) : next, outcome };
}
