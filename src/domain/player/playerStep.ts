import type { GameConfig } from '../config/gameConfig';
import { attackPhase } from '../combat/comboState';
import { volumeExtent, type HitVolume } from '../combat/hitVolume';
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
  scale,
  vec3,
  type Vec3,
} from '../math/vec3';
import { classifySurface, integrateGravity } from '../physics/surface';
import { consumeStamina, drainStamina, isStaminaEmpty } from '../stamina/stamina';
import { stickToWorldDirection } from '../stick/virtualStick';
import type { TerrainQuery } from '../terrain/terrainQuery';
import { startAction, startHold, startPress } from './actions/startAction';
import { stepArea } from './actions/areaAction';
import { stepCast } from './actions/castAction';
import { stepCharge } from './actions/chargeAction';
import { stepAirCombo, stepCombo } from './actions/comboAction';
import { stepGuard } from './actions/guardAction';
import { stepHitscan } from './actions/hitscanAction';
import { stepLunge } from './actions/lungeAction';
import { stepManeuver } from './actions/maneuverAction';
import { stepMultihit } from './actions/multihitAction';
import { stepPull } from './actions/pullAction';
import { stepThrow } from './actions/throwAction';
import { profileOf } from './actions/hitProfile';
import { shotOrigin } from './actions/runtime';
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
import { NO_INPUT, type PlayerStepInput } from './playerInput';
import {
  moveInAir,
  moveOnGround,
  moveVelocityTowards,
  playerCapsule,
  probeGround,
  type MoveResult,
} from './playerPhysics';
import type { ActiveBuff, PlayerState, PlayerStateName } from './playerState';
import type { AmmoState } from './playerState';
import {
  airControl,
  applyGravity,
  applyGround,
  clearAction,
  enter,
  enterSlide,
  groundSpeedFor,
  land,
  locomotionFor,
  moveGrounded,
  nextGroundState,
  regen,
  startDash,
  startFall,
  startJump,
  turnTowards,
  withStamina,
  type Ctx,
} from './stepCore';

// プレイヤーの状態更新(F01 / F04 / F08 / F11)。1 物理ステップぶんを純粋関数として進める。
// dt はエンティティ時間(ヒットストップ中は 0)。攻撃ボタンの行動は actions/ のエンジンが担う。

export { NO_INPUT, type PlayerStepInput };

export interface PlayerStepResult {
  readonly player: PlayerState;
  readonly events: readonly PlayerEvent[];
}

// ---- 遷移 -------------------------------------------------------------

function startSpecial(p: PlayerState, ctx: Ctx, name: 'burst'): PlayerState {
  const attackId = p.attackCounter + 1;
  ctx.events.push({ type: 'attackStarted', kind: name, stage: 1, action: null, styleId: null });
  return {
    ...enter(clearAction(p), name),
    velocity: ZERO3,
    attackCounter: attackId,
    attack: { stage: 1, elapsed: 0, attackId, hitTargets: [], bufferedAttack: false },
  };
}

/** 強制解放(向き切替・一時停止)でタメを破棄する。application から呼ぶ。 */
export function cancelCharge(p: PlayerState): { player: PlayerState; events: PlayerEvent[] } {
  if (p.name !== 'charge') return { player: p, events: [] };
  return {
    player: { ...enter(clearAction(p), 'idle'), chargeTime: 0, velocity: ZERO3 },
    events: [{ type: 'chargeCancelled' }],
  };
}

function startClimb(p: PlayerState, ctx: Ctx, wall: AttachCandidate): PlayerState {
  ctx.events.push({ type: 'climbAttached', wallNormal: wall.normal });
  if (p.name === 'glide') ctx.events.push({ type: 'glideEnded', reason: 'climb' });
  return {
    ...enter(clearAction(p), 'climb'),
    position: attachFeetPosition(wall, p.position, ctx.config),
    velocity: ZERO3,
    yaw: yawFacingWall(wall.normal),
    grounded: false,
    airAttackUsed: false,
    airAttackCount: 0,
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
    if (input.attackHoldStart) {
      const held = startHold(p, ctx);
      if (held) return held;
    }
    if (input.attack) {
      const pressed = startPress(p, ctx);
      if (pressed) return pressed;
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

function stepDash(p: PlayerState, ctx: Ctx): PlayerState {
  const { config, dt, input } = ctx;
  if (input.jump) return startJump(p, ctx);
  if (input.attackHoldStart && input.actionsAllowed) {
    const held = startHold(p, ctx);
    if (held) return held;
  }
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
  if (input.actionsAllowed && input.attackHoldStart) {
    const held = startHold(p, ctx);
    if (held) return held;
  }
  if (input.actionsAllowed && input.attack) {
    const pressed = startPress(p, ctx);
    if (pressed) return pressed;
  }
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

/** 滑空射撃(F11 glide_shot): 滑空を続けたまま真下へ間隔ごとに射撃する。 */
function tickGlideShot(p: PlayerState, ctx: Ctx): PlayerState {
  const runtime = p.action;
  if (runtime?.spec.kind !== 'movement' || runtime.spec.move !== 'glideShot') return p;
  const shot = runtime.then;
  if (shot?.kind !== 'multihit' || !shot.ranged) return { ...p, action: null };
  if (ctx.input.attackHoldEnd) {
    ctx.events.push({ type: 'attackEnded', kind: runtime.kind });
    return { ...p, action: null, attack: null };
  }
  const elapsed = runtime.elapsed + ctx.dt;
  let hits = runtime.hits;
  let nextAt = runtime.nextAt;
  let next = p;
  while (elapsed >= nextAt && hits < shot.count) {
    const attackId = next.attackCounter + 1;
    next = {
      ...next,
      attackCounter: attackId,
      attack: { stage: 1, elapsed: 0, attackId, hitTargets: [], bufferedAttack: false },
    };
    ctx.events.push({
      type: 'shotFired',
      kind: shot.hitClass,
      attackId,
      origin: shotOrigin(next, ctx),
      direction: vec3(0, -1, 0),
      directions: [vec3(0, -1, 0)],
      range: shot.ranged.range,
      damage: shot.damage,
      pierce: shot.ranged.pierce,
      beamWidth: shot.ranged.beamWidth,
      chargeRatio: 0,
      charged: false,
      profile: profileOf(shot),
    });
    hits++;
    nextAt += shot.interval;
  }
  return { ...next, action: { ...runtime, elapsed, hits, nextAt } };
}

function stepGlide(p: PlayerState, ctx: Ctx): PlayerState {
  const { config, dt, input } = ctx;
  if (input.jump) return endGlide(p, ctx, 'release');
  if (input.actionsAllowed && input.attackHoldStart && !p.action) {
    const held = startHold(p, ctx);
    if (held) p = held;
  }
  p = tickGlideShot(p, ctx);
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
      if (input.actionsAllowed && input.attackHoldStart) {
        const held = startHold(p, ctx);
        if (held) return held;
      }
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
  // 登攀中も地形との衝突を解決する。頭上の天井(法線が下向き)に達したら面を見失い Fall(F08 面の追従 4)
  const resolved = ctx.terrain.resolveCapsule(p.position, playerCapsule(config));
  const hitCeiling = resolved.contacts.some(
    (c) => classifySurface(c.normal.y, config.physics) === 'ceiling',
  );
  if (hitCeiling) return detachClimb(p, ctx, 'lost', 0);
  p = { ...p, position: resolved.position };
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

/** バースト(F03 / F04。設定値で固定の範囲攻撃。固定スキルは F12 で廃止)。 */
function stepSpecial(p: PlayerState, ctx: Ctx): PlayerState {
  const attack = p.attack;
  if (!attack) return enter(p, 'idle');
  const { config, dt } = ctx;
  const kind: AttackKind = 'burst';
  const timing = config.combat.burst;
  const elapsed = attack.elapsed + dt;
  let next: PlayerState = { ...p, stateTime: p.stateTime + dt, attack: { ...attack, elapsed } };
  if (attackPhase(elapsed, timing) === 'active') {
    const volume: HitVolume = {
      type: 'sphere',
      center: add(p.position, vec3(0, config.physics.playerCapsuleHeight / 2, 0)),
      radius: timing.radius,
    };
    const extent = volumeExtent(volume);
    ctx.events.push({
      type: 'attackActive',
      kind,
      attackId: attack.attackId,
      center: extent.center,
      radius: extent.radius,
      damage: timing.damage,
      volume,
      profile: null,
    });
  }
  const moved = moveGrounded(next, ctx, ZERO3);
  next = moved.next;
  if (moved.outcome === 'fell') {
    ctx.events.push({ type: 'attackEnded', kind });
    return startFall(next, ctx, false);
  }
  next = regen(next, ctx, true);
  if (elapsed < timing.total) return next;
  ctx.events.push({ type: 'attackEnded', kind });
  return enter(clearAction(next), 'idle');
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
      return stepCombo(p, ctx);
    case 'airAttack':
      return stepAirCombo(p, ctx);
    case 'burst':
      return stepSpecial(p, ctx);
    case 'strongAttack':
      return stepLunge(p, ctx);
    case 'shoot':
    case 'chargedShot':
      return stepHitscan(p, ctx);
    case 'charge':
      return stepCharge(p, ctx);
    case 'area':
      return stepArea(p, ctx);
    case 'multihit':
      return stepMultihit(p, ctx);
    case 'throw':
      return stepThrow(p, ctx);
    case 'cast':
      return stepCast(p, ctx);
    case 'guard':
      return stepGuard(p, ctx);
    case 'maneuver':
      return stepManeuver(p, ctx);
    case 'pull':
      return stepPull(p, ctx);
    case 'hit':
      return stepHit(p, ctx);
    case 'dead':
      return stepDead(p, ctx);
  }
}

function tickBuffs(buffs: readonly ActiveBuff[], dt: number): readonly ActiveBuff[] {
  const next: ActiveBuff[] = [];
  for (const b of buffs) {
    const remaining = Math.max(0, b.remaining - dt);
    const beatTime = b.beatTime + dt;
    if (remaining > 0) {
      next.push({ ...b, remaining, beatTime });
      continue;
    }
    // コンボ成長は切れてもスタックが 0 に戻るだけで残る(HUD のヒット数表示)
    if (b.effect === 'momentum') next.push({ ...b, remaining: 0, stacks: 0, beatTime });
  }
  return next;
}

function tickTimers(p: PlayerState, dt: number): PlayerState {
  const tickAmmo = (a: AmmoState | null): AmmoState | null =>
    a && a.reloadRemaining > 0
      ? a.reloadRemaining - dt <= 0
        ? { ...a, remaining: a.capacity, reloadRemaining: 0 }
        : { ...a, reloadRemaining: a.reloadRemaining - dt }
      : a;
  const ammo = {
    head: tickAmmo(p.ammo.head),
    rightArm: tickAmmo(p.ammo.rightArm),
    leftArm: tickAmmo(p.ammo.leftArm),
  };
  return {
    ...p,
    invincibleRemaining: Math.max(0, p.invincibleRemaining - dt),
    comboWindowRemaining: Math.max(0, p.comboWindowRemaining - dt),
    coyoteRemaining: Math.max(0, p.coyoteRemaining - dt),
    jumpBufferRemaining: Math.max(0, p.jumpBufferRemaining - dt),
    knockbackRemaining: Math.max(0, p.knockbackRemaining - dt),
    sinceDash: p.name === 'dash' ? 0 : p.sinceDash + dt,
    buffs: tickBuffs(p.buffs, dt),
    ammo,
  };
}

function applySprintHold(p: PlayerState, input: PlayerStepInput): PlayerState {
  if (input.sprintHoldStart) return { ...p, sprintHeld: true };
  if (input.sprintHoldEnd) return { ...p, sprintHeld: false };
  return p;
}

const BUFFERS_ATTACK: readonly PlayerStateName[] = ['attack', 'shoot', 'throw'];

/** ヒットストップ中(dt = 0)は入力の受付(バッファ)だけを行う。 */
function stepFrozen(p: PlayerState, input: PlayerStepInput): PlayerState {
  const held: PlayerState = {
    ...applySprintHold(p, input),
    bufferedAttackHold: {
      start: p.bufferedAttackHold.start || input.attackHoldStart,
      end: p.bufferedAttackHold.end || input.attackHoldEnd,
    },
  };
  if (BUFFERS_ATTACK.includes(held.name) && held.attack && input.attack) {
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
  // 実行中の技と別スロットの技の入力は中断せず捨てる(F12)
  if (player.techniqueSlot !== null && input.slot !== player.techniqueSlot) {
    input = { ...input, attack: false, attackHoldStart: false, attackHoldEnd: false };
  }
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
    startAction,
    startPress,
    startHold,
  };
  const prepared = tickTimers(applySprintHold(released.player, input), dt);
  const next = dispatch(prepared, ctx);
  return { player: next, events };
}

/** プレイヤーの攻撃が当たったときの能力変化(コンボ成長のスタック)。application から呼ぶ。 */
export function recordPlayerHit(p: PlayerState): PlayerState {
  const momentum = p.buffs.find((b) => b.effect === 'momentum');
  if (!momentum) return p;
  const stacks = Math.min(momentum.maxStacks, momentum.stacks + 1);
  return {
    ...p,
    buffs: p.buffs.map((b) =>
      b.effect === 'momentum' ? { ...b, stacks, remaining: b.duration } : b,
    ),
  };
}

/** カプセル中心。 */
export function playerCenter(p: PlayerState, config: GameConfig): Vec3 {
  return add(p.position, vec3(0, config.physics.playerCapsuleHeight / 2, 0));
}
