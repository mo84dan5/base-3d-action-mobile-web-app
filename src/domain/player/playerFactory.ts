import type { GameConfig } from '../config/gameConfig';
import { UP, ZERO3, type Vec3 } from '../math/vec3';
import { createStamina } from '../stamina/stamina';
import type { PlayerState } from './playerState';

export function createPlayer(position: Vec3, yaw: number, config: GameConfig): PlayerState {
  return {
    name: 'idle',
    position,
    velocity: ZERO3,
    yaw,
    hp: config.combat.playerMaxHp,
    stamina: createStamina(config.stamina),
    stateTime: 0,
    groundNormal: UP,
    grounded: true,
    coyoteRemaining: 0,
    jumpBufferRemaining: 0,
    airAttackUsed: false,
    lastAttackStage: 0,
    comboWindowRemaining: 0,
    attack: null,
    strong: null,
    bufferedAttackHold: { start: false, end: false },
    chargeTime: 0,
    chargeRatio: 0,
    climb: null,
    glideTime: 0,
    glideStartVy: 0,
    stunRemaining: 0,
    invincibleRemaining: 0,
    knockback: ZERO3,
    knockbackRemaining: 0,
    hitstopSteps: 0,
    sprintHeld: false,
    dashDirection: ZERO3,
    attackCounter: 0,
    pendingHit: null,
  };
}
