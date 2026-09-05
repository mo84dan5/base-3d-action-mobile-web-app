import type { MovementRequirement, MovementSpec } from '../../attackStyle/actionSpec';
import { degToRad } from '../../config/gameConfig';
import {
  UP,
  ZERO3,
  add,
  cross,
  directionFromYaw,
  normalize,
  rotateTowards,
  scale,
  vec3,
  yawFromDirection,
  type Vec3,
} from '../../math/vec3';
import { drainStamina, isStaminaEmpty } from '../../stamina/stamina';
import { playerCapsule } from '../playerPhysics';
import type { PlayerState } from '../playerState';
import {
  clearAction,
  enter,
  enterSlide,
  finishAction,
  moveAirborne,
  moveGrounded,
  startFall,
  withStamina,
  type Ctx,
  type StartActionOptions,
} from '../stepCore';
import { jumpSpeedForHeight } from './areaAction';
import { chainThen, newAttack, newRuntime } from './runtime';

// N7 移動連動(F11)。回避・急降下・滑走・跳躍・転移などの移動を行い、完了後に then を始める。

const DASH_WINDOW_FALLBACK = 0.3;
const SKATE_TURN_DEG = 90;
const BLINK_BEHIND = 1.0;
const BLINK_SEARCH = { halfAngleDeg: 60, range: 8 };
const WALL_JUMP_BACK_SPEED = 3.0;
const WALL_KICK_UP_SPEED = 3.0;

export function requirementMet(
  p: PlayerState,
  ctx: Ctx,
  requires: MovementRequirement,
  windowSeconds: number,
): boolean {
  switch (requires) {
    case 'any':
      return true;
    case 'dash':
      return p.name === 'dash' || p.sinceDash <= (windowSeconds || DASH_WINDOW_FALLBACK);
    case 'airborne':
      return !p.grounded && p.name !== 'climb' && p.name !== 'glide';
    case 'sprint':
      return p.name === 'sprint';
    case 'climb':
      return p.name === 'climb' && p.climb?.phase === 'climbing';
    case 'glide':
      return p.name === 'glide';
    case 'wallNear':
      return p.grounded && ctx.input.wallAhead(1.0);
  }
}

function sideDirection(p: PlayerState, ctx: Ctx): Vec3 {
  if (ctx.magnitude > 0) return ctx.moveDir;
  return normalize(cross(directionFromYaw(p.yaw), UP));
}

function withRuntime(
  p: PlayerState,
  ctx: Ctx,
  spec: MovementSpec,
  opts: StartActionOptions,
  phase: string,
  dir: Vec3,
): PlayerState {
  const { attackId, attack } = newAttack(p, 1);
  return {
    ...p,
    attackCounter: attackId,
    attack,
    strong: null,
    invincibleRemaining: Math.max(p.invincibleRemaining, spec.invincible),
    action: newRuntime(spec, 'medium', opts, ctx.input.style.id, { phase, dir }),
  };
}

function launch(
  p: PlayerState,
  ctx: Ctx,
  spec: MovementSpec,
  opts: StartActionOptions,
  dir: Vec3,
  up: number,
  back: number,
): PlayerState {
  ctx.events.push({
    type: 'maneuverStarted',
    move: spec.move,
    position: p.position,
    direction: dir,
  });
  ctx.events.push({ type: 'jumped' });
  const horizontal = scale(dir, back);
  return {
    ...enter(withRuntime(p, ctx, spec, opts, 'air', dir), 'maneuver'),
    velocity: vec3(horizontal.x, up, horizontal.z),
    grounded: false,
    climb: null,
    coyoteRemaining: 0,
  };
}

export function startManeuver(
  p: PlayerState,
  ctx: Ctx,
  spec: MovementSpec,
  opts: StartActionOptions,
): PlayerState | null {
  if (!requirementMet(p, ctx, spec.requires, spec.windowSeconds)) return null;
  const { config } = ctx;
  const forward = directionFromYaw(p.yaw);
  const chained = { ...opts, then: spec.then };
  switch (spec.move) {
    case 'dodge': {
      const dir = sideDirection(p, ctx);
      ctx.events.push({
        type: 'maneuverStarted',
        move: spec.move,
        position: p.position,
        direction: dir,
      });
      return {
        ...enter(withRuntime(p, ctx, spec, chained, 'move', dir), 'maneuver'),
        velocity: ZERO3,
      };
    }
    case 'slide':
    case 'sprintRam':
    case 'dashSlash': {
      ctx.events.push({
        type: 'maneuverStarted',
        move: spec.move,
        position: p.position,
        direction: forward,
      });
      if (spec.then) {
        const started = ctx.startAction(
          { ...clearAction(p), name: p.grounded ? 'idle' : p.name },
          ctx,
          spec.then,
          { source: opts.source },
        );
        if (started)
          return {
            ...started,
            invincibleRemaining: Math.max(started.invincibleRemaining, spec.invincible),
          };
      }
      return {
        ...enter(withRuntime(p, ctx, spec, chained, 'move', forward), 'maneuver'),
        velocity: ZERO3,
      };
    }
    case 'skate':
      ctx.events.push({
        type: 'maneuverStarted',
        move: spec.move,
        position: p.position,
        direction: forward,
      });
      return {
        ...enter(withRuntime(p, ctx, spec, chained, 'skate', forward), 'maneuver'),
        velocity: ZERO3,
      };
    case 'dive':
    case 'airCombo': {
      ctx.events.push({
        type: 'maneuverStarted',
        move: spec.move,
        position: p.position,
        direction: vec3(0, -1, 0),
      });
      const fallSpeed = spec.fallSpeed ?? 0;
      return {
        ...enter(
          withRuntime(p, ctx, spec, chained, spec.move === 'dive' ? 'fall' : 'air', forward),
          'maneuver',
        ),
        velocity: spec.move === 'dive' ? vec3(0, -fallSpeed, 0) : p.velocity,
      };
    }
    case 'jump': {
      const speed = jumpSpeedForHeight(spec.height, config.physics.gravity);
      const jumped = launch(p, ctx, spec, chained, forward, speed, 0);
      if (spec.then) {
        const started = ctx.startAction({ ...jumped, action: null, attack: null }, ctx, spec.then, {
          source: opts.source,
        });
        if (started) return started;
      }
      return jumped;
    }
    case 'poleVault':
      return launch(
        p,
        ctx,
        spec,
        chained,
        forward,
        jumpSpeedForHeight(spec.height, config.physics.gravity),
        2.0,
      );
    case 'wallJump':
      return launch(
        p,
        ctx,
        spec,
        chained,
        scale(forward, -1),
        jumpSpeedForHeight(spec.height, config.physics.gravity),
        WALL_JUMP_BACK_SPEED,
      );
    case 'wallKick': {
      const normal = p.climb?.wallNormal ?? scale(forward, -1);
      ctx.events.push({ type: 'climbDetached', reason: 'release' });
      const kicked = launch(
        { ...p, climb: null },
        ctx,
        spec,
        chained,
        normal,
        WALL_KICK_UP_SPEED,
        spec.speed,
      );
      return { ...kicked, yaw: yawFromDirection(normal) };
    }
    case 'blink': {
      const target = ctx.input.findTarget(BLINK_SEARCH);
      const from = p.position;
      let to: Vec3;
      let yaw = p.yaw;
      if (target && target.distance <= BLINK_SEARCH.range) {
        const dir = directionFromYaw(target.yaw);
        const feet = add(p.position, scale(dir, target.distance));
        to = add(feet, scale(dir, BLINK_BEHIND));
        yaw = target.yaw + Math.PI;
      } else {
        to = add(p.position, scale(forward, spec.distance));
      }
      const resolved = ctx.terrain.resolveCapsule(to, playerCapsule(config)).position;
      ctx.events.push({ type: 'blinked', from, to: resolved });
      const moved: PlayerState = {
        ...p,
        position: resolved,
        yaw,
        invincibleRemaining: Math.max(p.invincibleRemaining, spec.invincible),
      };
      if (spec.then) {
        const started = ctx.startAction(clearAction(moved), ctx, spec.then, {
          source: opts.source,
        });
        if (started) return started;
      }
      return enter(clearAction(moved), 'idle');
    }
    case 'glideShot': {
      if (!spec.then) return null;
      ctx.events.push({
        type: 'maneuverStarted',
        move: spec.move,
        position: p.position,
        direction: vec3(0, -1, 0),
      });
      // 滑空を続けたまま真下へ射撃する。stepGlide が then(多段ヒット)のティックを進める
      return withRuntime(p, ctx, spec, chained, 'glideShot', vec3(0, -1, 0));
    }
  }
}

function endManeuver(p: PlayerState, ctx: Ctx): PlayerState {
  const chained = chainThen({ ...p, attack: null }, ctx);
  if (chained) return chained;
  return finishAction(p, ctx);
}

export function stepManeuver(p: PlayerState, ctx: Ctx): PlayerState {
  const runtime = p.action;
  if (runtime?.spec.kind !== 'movement') return finishAction(p, ctx);
  const spec = runtime.spec;
  const { config, dt, input } = ctx;
  const elapsed = runtime.elapsed + dt;
  switch (runtime.phase) {
    case 'move': {
      const remaining = Math.max(0, spec.distance - runtime.travelled);
      const step = Math.min(spec.speed * dt, remaining);
      const moved = moveGrounded(
        { ...p, stateTime: p.stateTime + dt },
        ctx,
        scale(runtime.dir, dt > 0 ? step / dt : 0),
      );
      const next = {
        ...moved.next,
        action: { ...runtime, elapsed, travelled: runtime.travelled + step },
      };
      if (moved.outcome === 'fell') return startFall(next, ctx, false);
      if (moved.outcome === 'slide') return enterSlide(next, ctx);
      if (step < remaining && moved.walls === 0) return next;
      return endManeuver(next, ctx);
    }
    case 'skate': {
      const rate = spec.staminaPerSecond ?? 0;
      let next = withStamina(p, ctx, drainStamina(p.stamina, rate, dt, config.stamina));
      const released = input.attackHoldEnd && runtime.source === 'hold';
      if (released || isStaminaEmpty(next.stamina)) return endManeuver(next, ctx);
      const desired = ctx.magnitude > 0 ? yawFromDirection(ctx.moveDir) : next.yaw;
      const yaw = rotateTowards(next.yaw, desired, degToRad(SKATE_TURN_DEG) * dt);
      const dir = directionFromYaw(yaw);
      const moved = moveGrounded(
        { ...next, yaw, stateTime: p.stateTime + dt },
        ctx,
        scale(dir, spec.speed),
      );
      next = {
        ...moved.next,
        action: { ...runtime, elapsed, dir, travelled: runtime.travelled + spec.speed * dt },
      };
      if (moved.outcome === 'fell') return startFall(next, ctx, false);
      if (moved.outcome === 'slide') return enterSlide(next, ctx);
      return next;
    }
    case 'fall': {
      const fallSpeed = spec.fallSpeed ?? 0;
      const moved = moveAirborne(
        { ...p, velocity: vec3(0, -fallSpeed, 0), stateTime: p.stateTime + dt },
        ctx,
      );
      const next = { ...moved.next, action: { ...runtime, elapsed } };
      if (moved.outcome === 'slide') return enterSlide(next, ctx);
      if (moved.outcome === 'air') return { ...next, velocity: vec3(0, -fallSpeed, 0) };
      return endManeuver(next, ctx);
    }
    case 'air':
    default: {
      const moved = moveAirborne({ ...p, stateTime: p.stateTime + dt }, ctx);
      const next = { ...moved.next, action: { ...runtime, elapsed } };
      if (moved.outcome === 'slide') return enterSlide(next, ctx);
      if (moved.outcome === 'air') return next;
      return endManeuver(next, ctx);
    }
  }
}
