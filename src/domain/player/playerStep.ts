import { degToRad, type GameConfig } from '../config/gameConfig';
import {
  advanceDistanceThisStep,
  attackPhase,
  canCancelAttack,
  nextComboStage,
} from '../combat/comboState';
import { attackSpherePosition } from '../combat/hitGeometry';
import type { AttackKind } from '../hitReaction/hitTables';
import {
  ZERO3,
  add,
  directionFromYaw,
  dot,
  horizontalLength,
  lerp,
  moveTowards,
  normalize,
  removeComponentAlong,
  rotateTowards,
  scale,
  vec3,
  yawFromDirection,
  type Vec3,
} from '../math/vec3';
import { integrateGravity } from '../physics/surface';
import {
  consumeStamina,
  drainStamina,
  isStaminaEmpty,
  regenerateStamina,
} from '../stamina/stamina';
import { stickToWorldDirection, type StickInput } from '../stick/virtualStick';
import type { TerrainQuery } from '../terrain/terrainQuery';
import {
  attachFeetPosition,
  climbVelocity,
  findAttachWall,
  findMantleTarget,
  reacquireWall,
  wallFrame,
  yawFacingWall,
  type AttachCandidate,
} from './playerClimb';
import type { PlayerEvent } from './playerEvents';
import { currentPlayerKnockback, releasePendingPlayerHit } from './playerHit';
import {
  moveInAir,
  moveOnGround,
  moveVelocityTowards,
  playerCapsule,
  probeGround,
  type MoveResult,
} from './playerPhysics';
import type { AttackData, PlayerState, PlayerStateName } from './playerState';
import type { AttackStyle } from '../settings/settings';

// プレイヤーの状態更新(F01 / F04 / F08)。1 物理ステップぶんを純粋関数として進める。
// dt はエンティティ時間(ヒットストップ中は 0)。

export interface PlayerStepInput {
  readonly stick: StickInput;
  readonly cameraYaw: number;
  readonly jump: boolean;
  readonly dash: boolean;
  readonly attack: boolean;
  readonly skill: boolean;
  readonly burst: boolean;
  readonly sprintHoldStart: boolean;
  readonly sprintHoldEnd: boolean;
  readonly attackHoldStart: boolean;
  readonly attackHoldEnd: boolean;
  /** 開始カウントダウン中は false(攻撃・スキル・バースト無効) */
  readonly actionsAllowed: boolean;
  /** 攻撃スタイル(F06 attackStyle) */
  readonly attackStyle: AttackStyle;
  /** 接近強攻撃のターゲット補正(±45 度・6 m の最近接敵。application が求める) */
  readonly strongTarget: { readonly yaw: number; readonly distance: number } | null;
  /** 射撃・タメ打ちのターゲット補正(±15 度・12 m の最近接敵) */
  readonly shootTarget: { readonly yaw: number } | null;
}

export const NO_INPUT: PlayerStepInput = {
  stick: { x: 0, y: 0, magnitude: 0 },
  cameraYaw: 0,
  jump: false,
  dash: false,
  attack: false,
  skill: false,
  burst: false,
  sprintHoldStart: false,
  sprintHoldEnd: false,
  attackHoldStart: false,
  attackHoldEnd: false,
  actionsAllowed: true,
  attackStyle: 'melee',
  strongTarget: null,
  shootTarget: null,
};

export interface PlayerStepResult {
  readonly player: PlayerState;
  readonly events: readonly PlayerEvent[];
}

interface Ctx {
  readonly input: PlayerStepInput;
  readonly terrain: TerrainQuery;
  readonly dt: number;
  readonly config: GameConfig;
  readonly events: PlayerEvent[];
  /** 世界座標の移動方向(長さ = 入力の大きさ) */
  readonly move: Vec3;
  readonly moveDir: Vec3;
  readonly magnitude: number;
}

function enter(p: PlayerState, name: PlayerStateName): PlayerState {
  return { ...p, name, stateTime: 0 };
}

function locomotionFor(magnitude: number, config: GameConfig): PlayerStateName {
  if (magnitude === 0) return 'idle';
  return magnitude >= config.stick.runThreshold ? 'run' : 'walk';
}

function groundSpeedFor(magnitude: number, config: GameConfig): number {
  if (magnitude === 0) return 0;
  return magnitude >= config.stick.runThreshold
    ? config.movement.runSpeed
    : config.movement.walkSpeed;
}

function turnTowards(p: PlayerState, dir: Vec3, speedDeg: number, dt: number): PlayerState {
  if (dir.x === 0 && dir.z === 0) return p;
  return { ...p, yaw: rotateTowards(p.yaw, yawFromDirection(dir), degToRad(speedDeg) * dt) };
}

function withStamina(p: PlayerState, ctx: Ctx, next: PlayerState['stamina']): PlayerState {
  if (!isStaminaEmpty(p.stamina) && isStaminaEmpty(next)) {
    ctx.events.push({ type: 'staminaDepleted' });
  }
  return { ...p, stamina: next };
}

function regen(p: PlayerState, ctx: Ctx, canRegen: boolean): PlayerState {
  return { ...p, stamina: regenerateStamina(p.stamina, ctx.dt, canRegen, ctx.config.stamina) };
}

function applyGround(p: PlayerState, r: MoveResult): PlayerState {
  return {
    ...p,
    position: r.position,
    velocity: r.velocity,
    grounded: r.ground.kind === 'walkable',
    groundNormal: r.ground.kind === 'none' ? p.groundNormal : r.ground.normal,
  };
}

// ---- 遷移 -------------------------------------------------------------

function startJump(p: PlayerState, ctx: Ctx): PlayerState {
  ctx.events.push({ type: 'jumped' });
  return {
    ...enter(p, 'jump'),
    velocity: vec3(p.velocity.x, ctx.config.movement.jumpSpeed, p.velocity.z),
    grounded: false,
    coyoteRemaining: 0,
    jumpBufferRemaining: 0,
    attack: null,
  };
}

function startFall(p: PlayerState, ctx: Ctx, coyote: boolean): PlayerState {
  return {
    ...enter(p, 'fall'),
    grounded: false,
    coyoteRemaining: coyote ? ctx.config.movement.coyoteTime : 0,
    attack: null,
    climb: null,
  };
}

function startDash(p: PlayerState, ctx: Ctx): PlayerState {
  const dir = ctx.magnitude > 0 ? ctx.moveDir : directionFromYaw(p.yaw);
  ctx.events.push({ type: 'dashStarted', direction: dir });
  return withStamina(
    {
      ...enter(p, 'dash'),
      dashDirection: dir,
      velocity: scale(dir, ctx.config.movement.dashSpeed),
      yaw: yawFromDirection(dir),
      attack: null,
    },
    ctx,
    consumeStamina(p.stamina, ctx.config.stamina.dashCost, ctx.config.stamina),
  );
}

function startAttack(p: PlayerState, ctx: Ctx, stage: 1 | 2 | 3): PlayerState {
  const attackId = p.attackCounter + 1;
  ctx.events.push({ type: 'attackStarted', kind: `normal${stage}`, stage });
  return {
    ...enter(p, 'attack'),
    velocity: ZERO3,
    attackCounter: attackId,
    attack: { stage, elapsed: 0, attackId, hitTargets: [], bufferedAttack: false },
  };
}

function startAirAttack(p: PlayerState, ctx: Ctx): PlayerState {
  const attackId = p.attackCounter + 1;
  ctx.events.push({ type: 'attackStarted', kind: 'airAttack', stage: 1 });
  return {
    ...enter(p, 'airAttack'),
    attackCounter: attackId,
    airAttackUsed: true,
    attack: { stage: 1, elapsed: 0, attackId, hitTargets: [], bufferedAttack: false },
  };
}

function startSpecial(p: PlayerState, ctx: Ctx, name: 'skill' | 'burst'): PlayerState {
  const attackId = p.attackCounter + 1;
  ctx.events.push({ type: 'attackStarted', kind: name, stage: 1 });
  return {
    ...enter(p, name),
    velocity: ZERO3,
    attackCounter: attackId,
    attack: { stage: 1, elapsed: 0, attackId, hitTargets: [], bufferedAttack: false },
  };
}

function startStrongAttack(p: PlayerState, ctx: Ctx): PlayerState {
  const { config, input } = ctx;
  const sa = config.combat.strongAttack;
  const attackId = p.attackCounter + 1;
  const yaw = input.strongTarget ? input.strongTarget.yaw : p.yaw;
  const maxLunge = sa.lungeSpeed * sa.lungeMaxTime;
  const lungeLimit = input.strongTarget
    ? Math.min(maxLunge, Math.max(0, input.strongTarget.distance - sa.lungeStopDistance))
    : maxLunge;
  const dir = directionFromYaw(yaw);
  ctx.events.push({ type: 'attackStarted', kind: 'strongAttack', stage: 1 });
  const phase = lungeLimit <= 1e-3 ? 'swing' : 'lunge';
  if (phase === 'lunge') ctx.events.push({ type: 'lungeStarted', direction: dir });
  return withStamina(
    {
      ...enter(p, 'strongAttack'),
      yaw,
      velocity: ZERO3,
      attackCounter: attackId,
      attack: { stage: 1, elapsed: 0, attackId, hitTargets: [], bufferedAttack: false },
      strong: { phase, lungeDir: dir, lungeTime: 0, lungeTravelled: 0, lungeLimit },
      lastAttackStage: 0,
      comboWindowRemaining: 0,
    },
    ctx,
    consumeStamina(p.stamina, sa.staminaCost, config.stamina),
  );
}

function startShoot(p: PlayerState, ctx: Ctx): PlayerState {
  const attackId = p.attackCounter + 1;
  const yaw = ctx.input.shootTarget ? ctx.input.shootTarget.yaw : p.yaw;
  ctx.events.push({ type: 'attackStarted', kind: 'shoot', stage: 1 });
  return {
    ...enter(p, 'shoot'),
    yaw,
    velocity: p.grounded ? vec3(0, 0, 0) : p.velocity,
    attackCounter: attackId,
    attack: { stage: 1, elapsed: 0, attackId, hitTargets: [], bufferedAttack: false },
  };
}

function startCharge(p: PlayerState, ctx: Ctx): PlayerState {
  ctx.events.push({ type: 'chargeStarted' });
  return {
    ...enter(p, 'charge'),
    attack: null,
    chargeTime: 0,
    velocity: vec3(p.velocity.x, 0, p.velocity.z),
  };
}

function startChargedShot(p: PlayerState, ctx: Ctx): PlayerState {
  const { config } = ctx;
  const attackId = p.attackCounter + 1;
  const ratio = Math.min(1, p.chargeTime / config.combat.chargedShot.maxChargeTime);
  const yaw = ctx.input.shootTarget ? ctx.input.shootTarget.yaw : p.yaw;
  ctx.events.push({ type: 'attackStarted', kind: 'chargedShot', stage: 1 });
  return {
    ...enter(p, 'chargedShot'),
    yaw,
    velocity: ZERO3,
    attackCounter: attackId,
    chargeRatio: ratio,
    chargeTime: 0,
    attack: { stage: 1, elapsed: 0, attackId, hitTargets: [], bufferedAttack: false },
  };
}

/** 強制解放(向き切替・一時停止)でタメを破棄する。application から呼ぶ。 */
export function cancelCharge(p: PlayerState): { player: PlayerState; events: PlayerEvent[] } {
  if (p.name !== 'charge') return { player: p, events: [] };
  return {
    player: { ...enter(p, 'idle'), chargeTime: 0, velocity: ZERO3 },
    events: [{ type: 'chargeCancelled' }],
  };
}

function startClimb(p: PlayerState, ctx: Ctx, wall: AttachCandidate): PlayerState {
  ctx.events.push({ type: 'climbAttached', wallNormal: wall.normal });
  if (p.name === 'glide') ctx.events.push({ type: 'glideEnded', reason: 'climb' });
  return {
    ...enter(p, 'climb'),
    position: attachFeetPosition(wall, p.position, ctx.config),
    velocity: ZERO3,
    yaw: yawFacingWall(wall.normal),
    grounded: false,
    attack: null,
    airAttackUsed: false,
    climb: { phase: 'attach', wallNormal: wall.normal, phaseTime: 0 },
  };
}

function detachClimb(
  p: PlayerState,
  ctx: Ctx,
  reason: 'release' | 'stamina' | 'lost',
  speed: number,
): PlayerState {
  ctx.events.push({ type: 'climbDetached', reason });
  const normal = p.climb?.wallNormal ?? directionFromYaw(p.yaw + Math.PI);
  return { ...startFall(p, ctx, false), velocity: scale(normal, speed) };
}

function startGlide(p: PlayerState, ctx: Ctx): PlayerState {
  ctx.events.push({ type: 'glideStarted' });
  const h = horizontalLength(p.velocity);
  const max = ctx.config.glide.maxHorizontalSpeed;
  const velocity =
    h > max ? vec3((p.velocity.x * max) / h, p.velocity.y, (p.velocity.z * max) / h) : p.velocity;
  return { ...enter(p, 'glide'), velocity, glideTime: 0, glideStartVy: p.velocity.y };
}

function endGlide(p: PlayerState, ctx: Ctx, reason: 'release' | 'stamina'): PlayerState {
  ctx.events.push({ type: 'glideEnded', reason });
  return startFall(p, ctx, false);
}

function land(p: PlayerState, ctx: Ctx, r: MoveResult): PlayerState {
  ctx.events.push({ type: 'landed', fallSpeed: Math.max(0, -p.velocity.y) });
  if (p.name === 'glide') ctx.events.push({ type: 'glideEnded', reason: 'landed' });
  const landed: PlayerState = {
    ...applyGround(p, r),
    velocity: vec3(r.velocity.x, 0, r.velocity.z),
    airAttackUsed: false,
    climb: null,
    attack: p.name === 'airAttack' ? p.attack : null,
  };
  if (p.name === 'airAttack') return landed;
  if (landed.jumpBufferRemaining > 0) return startJump(landed, ctx);
  return enter(landed, nextGroundState(landed, ctx));
}

function nextGroundState(p: PlayerState, ctx: Ctx): PlayerStateName {
  if (p.sprintHeld && ctx.magnitude > 0 && !isStaminaEmpty(p.stamina)) return 'sprint';
  return locomotionFor(ctx.magnitude, ctx.config);
}

function tryAttachFromGround(p: PlayerState, ctx: Ctx): PlayerState | null {
  if (ctx.magnitude === 0 || isStaminaEmpty(p.stamina)) return null;
  const wall = findAttachWall(
    p.position,
    ctx.moveDir,
    ctx.config.climb.attachReach,
    ctx.terrain,
    ctx.config,
  );
  if (!wall || dot(ctx.moveDir, scale(wall.normal, -1)) < 0.3) return null;
  return startClimb(p, ctx, wall);
}

function tryAttachFromAir(p: PlayerState, ctx: Ctx, r: MoveResult): PlayerState | null {
  if (isStaminaEmpty(p.stamina)) return null;
  for (const w of r.walls) {
    const wall = findAttachWall(r.position, scale(w.normal, -1), 0.15, ctx.terrain, ctx.config);
    if (wall) return startClimb({ ...p, position: r.position }, ctx, wall);
  }
  return null;
}

// ---- 状態ごとの更新 ---------------------------------------------------

function stepGroundLocomotion(p: PlayerState, ctx: Ctx): PlayerState {
  const { input, config, dt } = ctx;
  const attached = p.name !== 'idle' ? tryAttachFromGround(p, ctx) : null;
  if (attached) return attached;
  if (input.jump) return startJump(p, ctx);
  if (input.dash && !isStaminaEmpty(p.stamina)) return startDash(p, ctx);
  if (input.actionsAllowed) {
    if (input.burst) return startSpecial(p, ctx, 'burst');
    if (input.skill) return startSpecial(p, ctx, 'skill');
    if (input.attackHoldStart) {
      if (input.attackStyle === 'gun') return startCharge(p, ctx);
      if (!isStaminaEmpty(p.stamina)) return startStrongAttack(p, ctx);
    }
    if (input.attack) {
      if (input.attackStyle === 'gun') return startShoot(p, ctx);
      return startAttack(p, ctx, nextComboStage(p.lastAttackStage, p.comboWindowRemaining));
    }
  }
  const sprinting = p.sprintHeld && ctx.magnitude > 0 && !isStaminaEmpty(p.stamina);
  const speed = sprinting ? config.movement.sprintSpeed : groundSpeedFor(ctx.magnitude, config);
  const target = scale(ctx.moveDir, speed);
  const velocity = moveVelocityTowards(
    vec3(p.velocity.x, 0, p.velocity.z),
    target,
    config.movement.acceleration * dt,
  );
  let next = turnTowards({ ...p, velocity }, ctx.moveDir, config.movement.turnSpeedDeg, dt);
  const r = moveOnGround(
    next.position,
    next.velocity,
    dt,
    playerCapsule(config),
    ctx.terrain,
    config,
  );
  next = applyGround(next, r);
  if (r.ground.kind === 'none') return startFall(next, ctx, true);
  if (r.ground.kind === 'slide') return enterSlide(next, ctx);
  const nextName: PlayerStateName = sprinting ? 'sprint' : locomotionFor(ctx.magnitude, config);
  if (nextName === 'sprint' && p.name !== 'sprint') ctx.events.push({ type: 'sprintStarted' });
  if (nextName !== 'sprint' && p.name === 'sprint') ctx.events.push({ type: 'sprintEnded' });
  next = nextName === p.name ? { ...next, stateTime: p.stateTime + dt } : enter(next, nextName);
  if (sprinting) {
    return withStamina(
      next,
      ctx,
      drainStamina(next.stamina, config.stamina.sprintCostPerSecond, dt, config.stamina),
    );
  }
  return regen(next, ctx, true);
}

function enterSlide(p: PlayerState, ctx: Ctx): PlayerState {
  ctx.events.push({ type: 'slideStarted' });
  return { ...enter(p, 'slide'), grounded: false, attack: null };
}

function stepDash(p: PlayerState, ctx: Ctx): PlayerState {
  const { config, dt, input } = ctx;
  if (input.jump) return startJump(p, ctx);
  const velocity = scale(p.dashDirection, config.movement.dashSpeed);
  const r = moveOnGround(p.position, velocity, dt, playerCapsule(config), ctx.terrain, config);
  let next = { ...applyGround(p, r), stateTime: p.stateTime + dt };
  if (r.ground.kind === 'none') return startFall(next, ctx, true);
  if (r.ground.kind === 'slide') return enterSlide(next, ctx);
  if (next.stateTime + 1e-9 >= config.movement.dashDuration) {
    const name = nextGroundState(next, ctx);
    if (name === 'sprint') ctx.events.push({ type: 'sprintStarted' });
    next = enter(next, name);
  }
  return next;
}

function airControl(p: PlayerState, ctx: Ctx): PlayerState {
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

/** 重力を積分する。位置の更新には前後の鉛直速度の平均を使う(到達高が解析値 1.225 m と一致する)。 */
function applyGravity(v: Vec3, ctx: Ctx): { velocity: Vec3; moveVelocity: Vec3 } {
  const vy = integrateGravity(v.y, ctx.dt, ctx.config.physics);
  return { velocity: vec3(v.x, vy, v.z), moveVelocity: vec3(v.x, (v.y + vy) / 2, v.z) };
}

function canGlide(p: PlayerState, ctx: Ctx): boolean {
  if (isStaminaEmpty(p.stamina)) return false;
  const hit = ctx.terrain.raycast(p.position, vec3(0, -1, 0), ctx.config.glide.minAltitude);
  return hit === null;
}

function resolveAirJumpInput(p: PlayerState, ctx: Ctx): PlayerState {
  if (p.name === 'fall' && p.coyoteRemaining > 0) return startJump(p, ctx);
  if (p.name === 'fall' && canGlide(p, ctx)) return startGlide(p, ctx);
  return { ...p, jumpBufferRemaining: ctx.config.movement.jumpBufferTime };
}

function stepAirborne(p: PlayerState, ctx: Ctx): PlayerState {
  const { config, dt, input } = ctx;
  if (input.attack && input.actionsAllowed && input.attackStyle === 'gun')
    return startShoot(p, ctx);
  if (input.attack && input.actionsAllowed && !p.airAttackUsed) return startAirAttack(p, ctx);
  if (input.jump) {
    const resolved = resolveAirJumpInput(p, ctx);
    if (resolved.name !== p.name) return resolved;
    p = resolved;
  }
  let next = airControl(p, ctx);
  const gravity = applyGravity(next.velocity, ctx);
  next = { ...next, velocity: gravity.velocity };
  const r = moveInAir(
    next.position,
    gravity.moveVelocity,
    dt,
    playerCapsule(config),
    ctx.terrain,
    config,
  );
  const attached = tryAttachFromAir(next, ctx, r);
  if (attached) return attached;
  next = {
    ...applyGround(next, r),
    velocity: vec3(
      r.velocity.x,
      r.hitCeiling ? Math.min(0, gravity.velocity.y) : gravity.velocity.y,
      r.velocity.z,
    ),
    stateTime: p.stateTime + dt,
  };
  if (r.ground.kind === 'walkable') return land(next, ctx, r);
  if (r.ground.kind === 'slide') return enterSlide({ ...next, position: r.position }, ctx);
  if (next.name === 'jump' && next.velocity.y <= 0) return startFall(next, ctx, false);
  return next;
}

function stepSlide(p: PlayerState, ctx: Ctx): PlayerState {
  const { config, dt } = ctx;
  let velocity = vec3(
    p.velocity.x,
    integrateGravity(p.velocity.y, dt, config.physics),
    p.velocity.z,
  );
  if (dot(velocity, p.groundNormal) < 0) velocity = removeComponentAlong(velocity, p.groundNormal);
  const r = moveInAir(p.position, velocity, dt, playerCapsule(config), ctx.terrain, config);
  const next = { ...applyGround(p, r), stateTime: p.stateTime + dt };
  if (r.ground.kind === 'walkable') return land(next, ctx, r);
  if (r.ground.kind === 'none') return startFall(next, ctx, false);
  return next;
}

function stepGlide(p: PlayerState, ctx: Ctx): PlayerState {
  const { config, dt, input } = ctx;
  if (input.jump) return endGlide(p, ctx, 'release');
  const g = config.glide;
  const vyRate = Math.abs(p.glideStartVy - -g.descentSpeed) / g.descentBlendTime;
  const vy = moveTowards(p.velocity.y, -g.descentSpeed, vyRate * dt);
  const h = vec3(p.velocity.x, 0, p.velocity.z);
  const targetH = ctx.magnitude > 0 ? scale(ctx.moveDir, g.maxHorizontalSpeed) : ZERO3;
  const accel =
    ctx.magnitude > 0 ? g.horizontalAcceleration : g.maxHorizontalSpeed / g.horizontalDecelTime;
  const nh = moveVelocityTowards(h, targetH, accel * dt);
  let next = turnTowards({ ...p, velocity: vec3(nh.x, vy, nh.z) }, ctx.moveDir, g.turnSpeedDeg, dt);
  next = withStamina(
    next,
    ctx,
    drainStamina(next.stamina, config.stamina.glideCostPerSecond, dt, config.stamina),
  );
  if (isStaminaEmpty(next.stamina)) return endGlide(next, ctx, 'stamina');
  const r = moveInAir(next.position, next.velocity, dt, playerCapsule(config), ctx.terrain, config);
  const attached = tryAttachFromAir(next, ctx, r);
  if (attached) return attached;
  next = { ...applyGround(next, r), stateTime: p.stateTime + dt, glideTime: p.glideTime + dt };
  if (r.ground.kind === 'walkable') return land(next, ctx, r);
  if (r.ground.kind === 'slide') {
    ctx.events.push({ type: 'glideEnded', reason: 'landed' });
    return enterSlide(next, ctx);
  }
  return next;
}

function stepClimb(p: PlayerState, ctx: Ctx): PlayerState {
  const climb = p.climb;
  if (!climb) return startFall(p, ctx, false);
  const { config, dt, input } = ctx;
  const phaseTime = climb.phaseTime + dt;
  switch (climb.phase) {
    case 'attach':
      if (phaseTime < config.climb.attachAnimTime)
        return { ...p, stateTime: p.stateTime + dt, climb: { ...climb, phaseTime } };
      return {
        ...p,
        stateTime: p.stateTime + dt,
        climb: { ...climb, phase: 'climbing', phaseTime: 0 },
      };
    case 'mantle': {
      const t = Math.min(1, phaseTime / config.climb.mantleTime);
      const from = climb.mantleFrom ?? p.position;
      const to = climb.mantleTo ?? p.position;
      const position = lerp(from, to, t);
      if (t < 1)
        return { ...p, position, stateTime: p.stateTime + dt, climb: { ...climb, phaseTime } };
      return { ...enter({ ...p, position, grounded: true, climb: null, velocity: ZERO3 }, 'idle') };
    }
    case 'cliffJump': {
      const frame = wallFrame(climb.wallNormal);
      const moved = add(p.position, scale(frame.up, config.climb.cliffJumpSpeed * dt));
      const next = followWall({ ...p, position: moved }, ctx, climb.wallNormal);
      if (next.name !== 'climb' || !next.climb) return next;
      const phase = phaseTime + 1e-9 >= config.climb.cliffJumpDuration ? 'climbing' : 'cliffJump';
      return {
        ...next,
        stateTime: p.stateTime + dt,
        climb: { ...next.climb, phase, phaseTime: phase === 'climbing' ? 0 : phaseTime },
      };
    }
    case 'climbing': {
      if (input.dash) return detachClimb(p, ctx, 'release', config.climb.detachSpeed);
      if (input.jump && !isStaminaEmpty(p.stamina)) {
        ctx.events.push({ type: 'cliffJumped' });
        const next = withStamina(
          p,
          ctx,
          consumeStamina(p.stamina, config.stamina.cliffJumpCost, config.stamina),
        );
        return {
          ...next,
          stateTime: p.stateTime + dt,
          climb: { ...climb, phase: 'cliffJump', phaseTime: 0 },
        };
      }
      const frame = wallFrame(climb.wallNormal);
      const velocity = climbVelocity(input.stick.x, input.stick.y, ctx.magnitude, frame, config);
      let next: PlayerState = {
        ...p,
        velocity,
        stateTime: p.stateTime + dt,
        climb: { ...climb, phaseTime },
      };
      if (ctx.magnitude > 0) {
        next = withStamina(
          next,
          ctx,
          drainStamina(next.stamina, config.stamina.climbCostPerSecond, dt, config.stamina),
        );
        if (isStaminaEmpty(next.stamina))
          return detachClimb(next, ctx, 'stamina', config.climb.staminaOutDetachSpeed);
      }
      const moved = add(next.position, scale(velocity, dt));
      const movingDown = dot(velocity, frame.up) < 0;
      const followed = followWall({ ...next, position: moved }, ctx, climb.wallNormal);
      if (followed.name !== 'climb') return followed;
      if (movingDown) {
        const ground = probeGround(
          followed.position,
          playerCapsule(config),
          ctx.terrain,
          config.physics.groundCastDistance,
          config,
        );
        if (ground.kind === 'walkable') {
          ctx.events.push({ type: 'climbDetached', reason: 'release' });
          return enter(
            {
              ...followed,
              position: vec3(followed.position.x, ground.snapY, followed.position.z),
              grounded: true,
              groundNormal: ground.normal,
              climb: null,
              velocity: ZERO3,
            },
            'idle',
          );
        }
      }
      return followed;
    }
  }
}

/** 面の追従(頂上判定 → 面の再取得)。 */
function followWall(p: PlayerState, ctx: Ctx, normal: Vec3): PlayerState {
  const { config } = ctx;
  const mantleTo = findMantleTarget(p.position, normal, ctx.terrain, config);
  if (mantleTo && p.climb) {
    ctx.events.push({ type: 'mantled' });
    return {
      ...p,
      velocity: ZERO3,
      climb: { ...p.climb, phase: 'mantle', phaseTime: 0, mantleFrom: p.position, mantleTo },
    };
  }
  const wall = reacquireWall(p.position, normal, ctx.terrain, config);
  if (!wall || !p.climb) return detachClimb(p, ctx, 'lost', 0);
  return {
    ...p,
    position: wall.feet,
    yaw: yawFacingWall(wall.normal),
    climb: { ...p.climb, wallNormal: wall.normal },
  };
}

function attackTiming(p: PlayerState, ctx: Ctx) {
  const c = ctx.config.combat;
  switch (p.name) {
    case 'airAttack':
      return c.airAttack;
    case 'skill':
      return c.skill;
    case 'burst':
      return c.burst;
    case 'strongAttack':
      return c.strongAttack;
    case 'shoot':
      return c.shoot;
    case 'chargedShot':
      return c.chargedShot;
    default:
      return normalStage(p, ctx);
  }
}

function normalStage(p: PlayerState, ctx: Ctx) {
  const stage = p.attack?.stage ?? 1;
  return ctx.config.combat.normalAttack[stage - 1] ?? ctx.config.combat.normalAttack[0];
}

function attackKindOf(p: PlayerState): AttackKind {
  switch (p.name) {
    case 'airAttack':
      return 'airAttack';
    case 'skill':
      return 'skill';
    case 'burst':
      return 'burst';
    case 'strongAttack':
      return 'strongAttack';
    case 'shoot':
      return 'shoot';
    case 'chargedShot':
      return 'chargedShot';
    default:
      return `normal${p.attack?.stage ?? 1}`;
  }
}

function emitActive(p: PlayerState, ctx: Ctx, attack: AttackData): void {
  const c = ctx.config.combat;
  const kind = attackKindOf(p);
  const timing = attackTiming(p, ctx);
  const isArea = p.name === 'skill' || p.name === 'burst';
  const center = isArea
    ? add(p.position, vec3(0, ctx.config.physics.playerCapsuleHeight / 2, 0))
    : attackSpherePosition(
        p.position,
        p.yaw,
        c.hitSphereForward,
        ctx.config.physics.playerCapsuleHeight / 2,
      );
  const radius =
    p.name === 'skill'
      ? c.skill.radius
      : p.name === 'burst'
        ? c.burst.radius
        : p.name === 'strongAttack'
          ? c.strongAttack.radius
          : c.hitSphereRadius;
  ctx.events.push({
    type: 'attackActive',
    kind,
    attackId: attack.attackId,
    center,
    radius,
    damage: timing.damage,
  });
}

function stepGroundAttack(p: PlayerState, ctx: Ctx): PlayerState {
  const attack = p.attack;
  if (!attack) return enter(p, 'idle');
  const { config, dt, input } = ctx;
  const timing = attackTiming(p, ctx);
  const isNormal = p.name === 'attack';
  if (
    isNormal &&
    input.attackHoldStart &&
    input.attackStyle === 'melee' &&
    !isStaminaEmpty(p.stamina)
  ) {
    ctx.events.push({ type: 'attackEnded', kind: attackKindOf(p) });
    return startStrongAttack(p, ctx);
  }
  if (isNormal && canCancelAttack(attack.elapsed, timing)) {
    if (input.jump) return startJump(p, ctx);
    if (input.dash && !isStaminaEmpty(p.stamina)) return startDash(p, ctx);
  }
  const elapsed = attack.elapsed + dt;
  const buffered = attack.bufferedAttack || (isNormal && input.attack);
  let next: PlayerState = {
    ...p,
    stateTime: p.stateTime + dt,
    attack: { ...attack, elapsed, bufferedAttack: buffered },
  };
  if (attackPhase(elapsed, timing) === 'active' && next.attack) emitActive(next, ctx, next.attack);
  let velocity = ZERO3;
  if (isNormal) {
    const advance = advanceDistanceThisStep(attack.elapsed, dt, normalStage(p, ctx));
    if (advance > 0 && dt > 0) velocity = scale(directionFromYaw(p.yaw), advance / dt);
  }
  const r = moveOnGround(next.position, velocity, dt, playerCapsule(config), ctx.terrain, config);
  next = { ...applyGround(next, r), velocity: ZERO3 };
  if (r.ground.kind === 'none') {
    ctx.events.push({ type: 'attackEnded', kind: attackKindOf(p) });
    return startFall(next, ctx, false);
  }
  next = regen(next, ctx, true);
  if (elapsed < timing.total) return next;
  ctx.events.push({ type: 'attackEnded', kind: attackKindOf(p) });
  if (isNormal) {
    const ended: PlayerState = {
      ...next,
      attack: null,
      lastAttackStage: attack.stage,
      comboWindowRemaining: config.combat.comboWindow,
    };
    if (buffered && input.actionsAllowed)
      return startAttack(ended, ctx, nextComboStage(attack.stage, ended.comboWindowRemaining));
    return enter(ended, 'idle');
  }
  return enter({ ...next, attack: null }, 'idle');
}

function stepAirAttack(p: PlayerState, ctx: Ctx): PlayerState {
  const attack = p.attack;
  if (!attack) return startFall(p, ctx, false);
  const { config, dt } = ctx;
  const timing = config.combat.airAttack;
  const elapsed = attack.elapsed + dt;
  let next: PlayerState = { ...p, stateTime: p.stateTime + dt, attack: { ...attack, elapsed } };
  if (attackPhase(elapsed, timing) === 'active' && next.attack) emitActive(next, ctx, next.attack);
  if (next.grounded) {
    const r = moveOnGround(next.position, ZERO3, dt, playerCapsule(config), ctx.terrain, config);
    next = applyGround(next, r);
  } else {
    const gravity = applyGravity(next.velocity, ctx);
    next = { ...next, velocity: gravity.velocity };
    const r = moveInAir(
      next.position,
      gravity.moveVelocity,
      dt,
      playerCapsule(config),
      ctx.terrain,
      config,
    );
    next = {
      ...applyGround(next, r),
      velocity: vec3(r.velocity.x, gravity.velocity.y, r.velocity.z),
    };
    if (r.ground.kind === 'walkable') {
      ctx.events.push({ type: 'landed', fallSpeed: Math.max(0, -p.velocity.y) });
      next = { ...next, velocity: vec3(r.velocity.x, 0, r.velocity.z), airAttackUsed: false };
    }
    if (r.ground.kind === 'slide') {
      ctx.events.push({ type: 'attackEnded', kind: 'airAttack' });
      return enterSlide(next, ctx);
    }
  }
  if (elapsed < timing.total) return next;
  ctx.events.push({ type: 'attackEnded', kind: 'airAttack' });
  if (next.grounded) return enter({ ...next, attack: null }, nextGroundState(next, ctx));
  return startFall({ ...next, attack: null }, ctx, false);
}

function stepStrongAttack(p: PlayerState, ctx: Ctx): PlayerState {
  const strong = p.strong;
  const attack = p.attack;
  if (!strong || !attack) return enter(p, 'idle');
  const { config, dt } = ctx;
  const sa = config.combat.strongAttack;
  if (strong.phase === 'lunge') {
    // 最後のステップは残り距離に合わせて速度を落とし、目標の手前 1.0 m を越えないようにする
    const remaining = Math.max(0, strong.lungeLimit - strong.lungeTravelled);
    const stepDistance = Math.min(sa.lungeSpeed * dt, remaining);
    const velocity = scale(strong.lungeDir, dt > 0 ? stepDistance / dt : 0);
    const r = moveOnGround(p.position, velocity, dt, playerCapsule(config), ctx.terrain, config);
    const travelled = strong.lungeTravelled + stepDistance;
    const lungeTime = strong.lungeTime + dt;
    let next: PlayerState = {
      ...applyGround(p, r),
      velocity: ZERO3,
      stateTime: p.stateTime + dt,
      strong: { ...strong, lungeTime, lungeTravelled: travelled },
    };
    if (r.ground.kind === 'none') {
      ctx.events.push({ type: 'attackEnded', kind: 'strongAttack' });
      return startFall({ ...next, strong: null, attack: null }, ctx, false);
    }
    if (r.ground.kind === 'slide') return enterSlide({ ...next, strong: null, attack: null }, ctx);
    if (
      lungeTime + 1e-9 >= sa.lungeMaxTime ||
      travelled + 1e-9 >= strong.lungeLimit ||
      r.walls.length > 0
    ) {
      next = {
        ...next,
        strong: { ...strong, lungeTime, lungeTravelled: travelled, phase: 'swing' },
      };
    }
    return next;
  }
  const elapsed = attack.elapsed + dt;
  let next: PlayerState = { ...p, stateTime: p.stateTime + dt, attack: { ...attack, elapsed } };
  if (attackPhase(elapsed, sa) === 'active' && next.attack) emitActive(next, ctx, next.attack);
  const r = moveOnGround(next.position, ZERO3, dt, playerCapsule(config), ctx.terrain, config);
  next = { ...applyGround(next, r), velocity: ZERO3 };
  if (r.ground.kind === 'none') {
    ctx.events.push({ type: 'attackEnded', kind: 'strongAttack' });
    return startFall({ ...next, strong: null, attack: null }, ctx, false);
  }
  next = regen(next, ctx, true);
  if (elapsed < sa.total) return next;
  ctx.events.push({ type: 'attackEnded', kind: 'strongAttack' });
  return enter({ ...next, attack: null, strong: null }, 'idle');
}

function shotOrigin(p: PlayerState, ctx: Ctx): Vec3 {
  return add(p.position, vec3(0, ctx.config.climb.attachCheckHeights[0], 0));
}

function stepShoot(p: PlayerState, ctx: Ctx): PlayerState {
  const attack = p.attack;
  if (!attack) return enter(p, 'idle');
  const { config, dt, input } = ctx;
  const timing = config.combat.shoot;
  if (input.attackHoldStart && input.attackStyle === 'gun' && p.grounded)
    return startCharge(p, ctx);
  const elapsed = attack.elapsed + dt;
  const buffered = attack.bufferedAttack || input.attack;
  let next: PlayerState = {
    ...p,
    stateTime: p.stateTime + dt,
    attack: { ...attack, elapsed, bufferedAttack: buffered },
  };
  if (attack.elapsed < timing.startup && elapsed >= timing.startup) {
    ctx.events.push({
      type: 'shotFired',
      kind: 'shoot',
      attackId: attack.attackId,
      origin: shotOrigin(p, ctx),
      direction: directionFromYaw(p.yaw),
      range: timing.range,
      damage: timing.damage,
      pierce: false,
      chargeRatio: 0,
    });
  }
  if (next.grounded) {
    const r = moveOnGround(next.position, ZERO3, dt, playerCapsule(config), ctx.terrain, config);
    next = { ...applyGround(next, r), velocity: ZERO3 };
    if (r.ground.kind === 'slide') return enterSlide({ ...next, attack: null }, ctx);
    if (r.ground.kind !== 'none') next = regen(next, ctx, true);
  } else {
    const gravity = applyGravity(next.velocity, ctx);
    next = { ...next, velocity: gravity.velocity };
    const r = moveInAir(
      next.position,
      gravity.moveVelocity,
      dt,
      playerCapsule(config),
      ctx.terrain,
      config,
    );
    next = {
      ...applyGround(next, r),
      velocity: vec3(r.velocity.x, gravity.velocity.y, r.velocity.z),
    };
    if (r.ground.kind === 'walkable') {
      ctx.events.push({ type: 'landed', fallSpeed: Math.max(0, -p.velocity.y) });
      next = { ...next, velocity: vec3(r.velocity.x, 0, r.velocity.z), airAttackUsed: false };
    }
    if (r.ground.kind === 'slide') return enterSlide({ ...next, attack: null }, ctx);
  }
  if (elapsed < timing.total) return next;
  ctx.events.push({ type: 'attackEnded', kind: 'shoot' });
  if (buffered && input.actionsAllowed) return startShoot({ ...next, attack: null }, ctx);
  if (next.grounded) return enter({ ...next, attack: null }, nextGroundState(next, ctx));
  return startFall({ ...next, attack: null }, ctx, false);
}

function stepCharge(p: PlayerState, ctx: Ctx): PlayerState {
  const { config, dt, input } = ctx;
  if (input.attackHoldEnd) return startChargedShot(p, ctx);
  const cs = config.combat.chargedShot;
  const speed = Math.min(cs.chargeMoveSpeed, groundSpeedFor(ctx.magnitude, config));
  const target = scale(ctx.moveDir, speed);
  const velocity = moveVelocityTowards(
    vec3(p.velocity.x, 0, p.velocity.z),
    target,
    config.movement.acceleration * dt,
  );
  let next = turnTowards(
    { ...p, velocity, chargeTime: p.chargeTime + dt, stateTime: p.stateTime + dt },
    ctx.moveDir,
    config.movement.turnSpeedDeg,
    dt,
  );
  const r = moveOnGround(
    next.position,
    next.velocity,
    dt,
    playerCapsule(config),
    ctx.terrain,
    config,
  );
  next = applyGround(next, r);
  if (r.ground.kind === 'none' || r.ground.kind === 'slide') {
    ctx.events.push({ type: 'chargeCancelled' });
    next = { ...next, chargeTime: 0 };
    return r.ground.kind === 'none' ? startFall(next, ctx, true) : enterSlide(next, ctx);
  }
  return regen(next, ctx, true);
}

function stepChargedShot(p: PlayerState, ctx: Ctx): PlayerState {
  const attack = p.attack;
  if (!attack) return enter(p, 'idle');
  const { config, dt } = ctx;
  const cs = config.combat.chargedShot;
  const elapsed = attack.elapsed + dt;
  let next: PlayerState = { ...p, stateTime: p.stateTime + dt, attack: { ...attack, elapsed } };
  if (attack.elapsed < cs.startup && elapsed >= cs.startup) {
    ctx.events.push({
      type: 'shotFired',
      kind: 'chargedShot',
      attackId: attack.attackId,
      origin: shotOrigin(p, ctx),
      direction: directionFromYaw(p.yaw),
      range: cs.range,
      damage: cs.baseDamage + cs.bonusDamage * p.chargeRatio,
      pierce: true,
      chargeRatio: p.chargeRatio,
    });
  }
  const r = moveOnGround(next.position, ZERO3, dt, playerCapsule(config), ctx.terrain, config);
  next = { ...applyGround(next, r), velocity: ZERO3 };
  if (r.ground.kind === 'none') {
    ctx.events.push({ type: 'attackEnded', kind: 'chargedShot' });
    return startFall({ ...next, attack: null }, ctx, false);
  }
  next = regen(next, ctx, true);
  if (elapsed < cs.total) return next;
  ctx.events.push({ type: 'attackEnded', kind: 'chargedShot' });
  return enter({ ...next, attack: null }, 'idle');
}

function stepHit(p: PlayerState, ctx: Ctx): PlayerState {
  const { config, dt } = ctx;
  const stunRemaining = p.stunRemaining - dt;
  const velocity = currentPlayerKnockback(p, config.combat.knockbackDecayTime);
  const r = moveOnGround(p.position, velocity, dt, playerCapsule(config), ctx.terrain, config);
  let next: PlayerState = {
    ...applyGround(p, r),
    velocity: ZERO3,
    stateTime: p.stateTime + dt,
    stunRemaining,
  };
  if (r.ground.kind === 'none') return startFall({ ...next, velocity: r.velocity }, ctx, false);
  if (r.ground.kind === 'slide') return enterSlide(next, ctx);
  next = regen(next, ctx, true);
  if (stunRemaining > 0) return next;
  return enter({ ...next, stunRemaining: 0 }, 'idle');
}

function stepDead(p: PlayerState, ctx: Ctx): PlayerState {
  const { config, dt } = ctx;
  if (p.grounded) return { ...p, stateTime: p.stateTime + dt };
  const velocity = vec3(0, integrateGravity(p.velocity.y, dt, config.physics), 0);
  const r = moveInAir(p.position, velocity, dt, playerCapsule(config), ctx.terrain, config);
  return { ...applyGround(p, r), stateTime: p.stateTime + dt };
}

function dispatch(p: PlayerState, ctx: Ctx): PlayerState {
  switch (p.name) {
    case 'idle':
    case 'walk':
    case 'run':
    case 'sprint':
      return stepGroundLocomotion(p, ctx);
    case 'dash':
      return stepDash(p, ctx);
    case 'jump':
    case 'fall':
      return stepAirborne(p, ctx);
    case 'slide':
      return stepSlide(p, ctx);
    case 'climb':
      return stepClimb(p, ctx);
    case 'glide':
      return stepGlide(p, ctx);
    case 'attack':
    case 'skill':
    case 'burst':
      return stepGroundAttack(p, ctx);
    case 'airAttack':
      return stepAirAttack(p, ctx);
    case 'strongAttack':
      return stepStrongAttack(p, ctx);
    case 'shoot':
      return stepShoot(p, ctx);
    case 'charge':
      return stepCharge(p, ctx);
    case 'chargedShot':
      return stepChargedShot(p, ctx);
    case 'hit':
      return stepHit(p, ctx);
    case 'dead':
      return stepDead(p, ctx);
  }
}

function tickTimers(p: PlayerState, dt: number): PlayerState {
  return {
    ...p,
    invincibleRemaining: Math.max(0, p.invincibleRemaining - dt),
    comboWindowRemaining: Math.max(0, p.comboWindowRemaining - dt),
    coyoteRemaining: Math.max(0, p.coyoteRemaining - dt),
    jumpBufferRemaining: Math.max(0, p.jumpBufferRemaining - dt),
    knockbackRemaining: Math.max(0, p.knockbackRemaining - dt),
  };
}

function applySprintHold(p: PlayerState, input: PlayerStepInput): PlayerState {
  if (input.sprintHoldStart) return { ...p, sprintHeld: true };
  if (input.sprintHoldEnd) return { ...p, sprintHeld: false };
  return p;
}

/** ヒットストップ中(dt = 0)は入力の受付(バッファ)だけを行う。 */
function stepFrozen(p: PlayerState, input: PlayerStepInput): PlayerState {
  const held: PlayerState = {
    ...applySprintHold(p, input),
    bufferedAttackHold: {
      start: p.bufferedAttackHold.start || input.attackHoldStart,
      end: p.bufferedAttackHold.end || input.attackHoldEnd,
    },
  };
  if ((held.name === 'attack' || held.name === 'shoot') && held.attack && input.attack) {
    return { ...held, attack: { ...held.attack, bufferedAttack: true } };
  }
  return held;
}

export function stepPlayer(
  player: PlayerState,
  input: PlayerStepInput,
  terrain: TerrainQuery,
  dt: number,
  config: GameConfig,
): PlayerStepResult {
  if (dt <= 0) return { player: stepFrozen(player, input), events: [] };
  // ヒットストップ中に保持した長押し開始 / 終了をこのステップの入力に合流させる
  const buffered = player.bufferedAttackHold;
  if (buffered.start || buffered.end) {
    input = {
      ...input,
      attackHoldStart: input.attackHoldStart || buffered.start,
      attackHoldEnd: input.attackHoldEnd || buffered.end,
    };
    player = { ...player, bufferedAttackHold: { start: false, end: false } };
  }
  const events: PlayerEvent[] = [];
  const released = releasePendingPlayerHit(player);
  events.push(...released.events);
  const move = stickToWorldDirection(input.stick, input.cameraYaw);
  const magnitude = input.stick.magnitude;
  const ctx: Ctx = {
    input,
    terrain,
    dt,
    config,
    events,
    move,
    moveDir: magnitude > 0 ? normalize(move) : ZERO3,
    magnitude,
  };
  const prepared = tickTimers(applySprintHold(released.player, input), dt);
  const next = dispatch(prepared, ctx);
  return { player: next, events };
}

/** カプセル中心。 */
export function playerCenter(p: PlayerState, config: GameConfig): Vec3 {
  return add(p.position, vec3(0, config.physics.playerCapsuleHeight / 2, 0));
}
