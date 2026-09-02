import { computeButtonStates, type ButtonStates } from '../domain/action/actionGate';
import {
  cooldownRatio,
  isReady,
  READY_COOLDOWN,
  remainingSecondsLabel,
  startCooldown,
  tickCooldown,
  type Cooldown,
} from '../domain/action/cooldown';
import {
  createEnergy,
  energyRatio,
  gainEnergy,
  isEnergyFull,
  spendAllEnergy,
  type Energy,
} from '../domain/action/energy';
import { resolveHit, type HitResolution } from '../domain/combat/damage';
import {
  sphereCapsuleOverlap,
  closestPointOnCapsuleToSphere,
  targetCorrectionYaw,
  type Capsule,
} from '../domain/combat/hitGeometry';
import {
  createStats,
  evaluateResult,
  freezeStats,
  recordDamageTaken,
  recordDefeat,
  tickClearTime,
  type GameResult,
  type Stats,
} from '../domain/combat/result';
import { FIXED_STEP_SECONDS, type GameConfig } from '../domain/config/gameConfig';
import {
  isTelegraphing,
  stepEnemyAi,
  telegraphOpacity,
  type EnemyEvent,
} from '../domain/enemy/enemyAi';
import {
  applyEnemyHit,
  canEnemyBeStunned,
  createEnemy,
  deathProgress,
  enemyCenter,
  isDefeatTarget,
  isDefeated,
  isTargetable,
  releasePendingReactions,
  tickDeath,
  type EnemyState,
} from '../domain/enemy/enemyState';
import {
  damageNumberVisual,
  spawnDamageNumber,
  tickDamageNumbers,
  type DamageNumber,
} from '../domain/hitReaction/damageNumbers';
import {
  applyAttackerHitstop,
  createAttackerHitstopBudget,
  requestHitstop,
  tickHitstop,
  type AttackerHitstopBudget,
} from '../domain/hitReaction/entityTime';
import {
  flashIntensity,
  flashOpacity,
  startFlash,
  tickFlash,
  type HitFlash,
} from '../domain/hitReaction/hitFlash';
import { shakeForEvent, type AttackKind } from '../domain/hitReaction/hitTables';
import {
  createSignboard,
  findInteractTarget,
  showMessage,
  tickMessage,
  type Interactable,
  type InteractMessage,
} from '../domain/interact/interactable';
import { add, vec3, type Vec3 } from '../domain/math/vec3';
import { createPlayer } from '../domain/player/playerFactory';
import type { PlayerEvent } from '../domain/player/playerEvents';
import { applyPlayerHit } from '../domain/player/playerHit';
import { enemyCapsule, playerCapsule } from '../domain/player/playerPhysics';
import { hitCategoryOf, isGroundLocomotion, type PlayerState } from '../domain/player/playerState';
import { playerCenter, stepPlayer, type PlayerStepInput } from '../domain/player/playerStep';
import type { Settings } from '../domain/settings/settings';
import type { StageLayout } from '../domain/stage/stageLayout';
import { isStaminaLow } from '../domain/stamina/stamina';
import type { StickInput } from '../domain/stick/virtualStick';
import type { TerrainQuery } from '../domain/terrain/terrainQuery';
import {
  cancelCameraInput,
  createCameraRig,
  requestCameraShake,
  updateCameraRig,
  type CameraRigState,
} from './cameraRig';
import type { EffectEvent } from './effects';
import { stepEnemyPhysics, type EnemyPhysicsState } from './enemyPhysics';
import { accumulateFrameInput, EMPTY_FRAME_INPUT, type FrameInput } from './inputFrame';
import type { EffectPort, RandomSource } from './ports';
import { separatePair } from './separation';
import type {
  DamageNumberView,
  EnemyView,
  HudView,
  PlayerView,
  SessionPhase,
  ViewState,
} from './viewState';
import type { InputCommand } from '../domain/input/inputCommand';

// 1 回のプレイ(S02 開始 → リザルト)を表すセッション。固定 1/60 秒で更新する(F05 更新ループ)。
// domain の純粋関数を順序どおりに呼ぶ調整役であり、Three.js・DOM を知らない。

export interface GameSessionDeps {
  readonly terrain: TerrainQuery;
  readonly effects: EffectPort;
  readonly rng: RandomSource;
  readonly config: GameConfig;
  readonly stage: StageLayout;
}

const SPRINT_DUST_INTERVAL_STEPS = 8;

interface EnemySlot {
  state: EnemyState;
  physics: EnemyPhysicsState;
}

export class GameSession {
  player: PlayerState;
  playerFlash: HitFlash | null = null;
  enemies: EnemySlot[] = [];
  camera: CameraRigState;
  stats: Stats;
  phase: SessionPhase = 'countdown';
  result: GameResult | null = null;
  countdownRemaining: number;
  endingRemaining = 0;
  skillCooldown: Cooldown = READY_COOLDOWN;
  burstCooldown: Cooldown = READY_COOLDOWN;
  energy: Energy;
  damageNumbers: readonly DamageNumber[] = [];
  interactMessage: InteractMessage | null = null;
  worldTime = 0;
  private nextDamageNumberId = 1;
  private stick: StickInput = { x: 0, y: 0, magnitude: 0 };
  private sprintSteps = 0;
  private attackerBudget: AttackerHitstopBudget | null = null;
  private readonly interactables: readonly Interactable[];
  private lastPlayerDamage: DamageNumber | null = null;

  constructor(private readonly deps: GameSessionDeps) {
    const { config, stage } = deps;
    this.player = createPlayer(stage.playerStart, stage.playerStartYaw, config);
    this.enemies = stage.enemies.map((spawn, i) => ({
      state: createEnemy(i + 1, spawn.kind, spawn.position, config.enemy),
      physics: { verticalVelocity: 0 },
    }));
    this.camera = createCameraRig(this.player, config);
    this.stats = createStats(
      this.enemies.map((e) => ({ isDefeatTarget: isDefeatTarget(e.state), defeated: false })),
    );
    this.countdownRemaining =
      config.combat.countdownSeconds + config.combat.countdownStartLabelSeconds;
    this.energy = createEnergy(config.action);
    this.interactables = [createSignboard(stage.signboard.position, config.action)];
  }

  get config(): GameConfig {
    return this.deps.config;
  }

  get countdownActive(): boolean {
    return this.phase === 'countdown';
  }

  get acceptsInput(): boolean {
    return this.phase === 'countdown' || this.phase === 'playing';
  }

  /** 向き切替・一時停止時の入力キャンセル(F09 手順 1)。 */
  cancelInputs(): void {
    this.stick = { x: 0, y: 0, magnitude: 0 };
    this.camera = cancelCameraInput(this.camera);
    if (this.player.sprintHeld) this.player = { ...this.player, sprintHeld: false };
  }

  buttonStates(): ButtonStates {
    return computeButtonStates({
      playerState: this.player.name,
      climbPhase: this.player.climb?.phase ?? null,
      countdownActive: this.countdownActive,
      skillCooldownReady: isReady(this.skillCooldown),
      burstCooldownReady: isReady(this.burstCooldown),
      energyFull: isEnergyFull(this.energy),
      hasInteractTarget: this.interactTarget() !== null,
    });
  }

  interactTarget(): Interactable | null {
    return findInteractTarget(this.player.position, this.interactables);
  }

  /** 1 物理ステップ進める。 */
  step(commands: readonly InputCommand[], settings: Settings, dt = FIXED_STEP_SECONDS): void {
    const input = this.acceptsInput
      ? accumulateFrameInput(commands, this.stick)
      : { ...EMPTY_FRAME_INPUT, stick: this.stick };
    this.stick = input.stick;
    const gated = this.gateActions(input);
    this.tickWorldTimers(dt);
    this.stepPlayer(gated, dt);
    this.stepEnemies(dt);
    this.separate();
    this.stepInteract(gated);
    this.evaluateResult(dt);
    this.camera = updateCameraRig(
      this.camera,
      this.player,
      input,
      settings,
      this.deps.terrain,
      dt,
      this.config,
    );
    this.worldTime += dt;
  }

  private gateActions(input: FrameInput): FrameInput {
    const buttons = this.buttonStates();
    return {
      ...input,
      attack: input.attack && buttons.attack.enabled,
      skill: input.skill && buttons.skill.enabled,
      burst: input.burst && buttons.burst.enabled,
      interact: input.interact && buttons.interact.enabled,
    };
  }

  private tickWorldTimers(dt: number): void {
    const { config } = this;
    if (this.phase === 'countdown') {
      this.countdownRemaining -= dt;
      if (this.countdownRemaining <= 0) this.phase = 'playing';
    }
    if (this.phase === 'playing') this.stats = tickClearTime(this.stats, dt);
    this.skillCooldown = tickCooldown(this.skillCooldown, dt);
    this.burstCooldown = tickCooldown(this.burstCooldown, dt);
    this.damageNumbers = tickDamageNumbers(this.damageNumbers, dt, config.hitReaction);
    if (this.lastPlayerDamage && !this.damageNumbers.includes(this.lastPlayerDamage)) {
      const replaced = this.damageNumbers.find((n) => n.id === this.lastPlayerDamage?.id);
      this.lastPlayerDamage = replaced ?? null;
    }
    this.playerFlash = tickFlash(this.playerFlash);
    this.interactMessage = tickMessage(this.interactMessage, dt);
    this.player = { ...this.player, hitstopSteps: tickHitstop(this.player.hitstopSteps) };
    for (const slot of this.enemies) {
      slot.state = {
        ...slot.state,
        hitstopSteps: tickHitstop(slot.state.hitstopSteps),
        flash: tickFlash(slot.state.flash),
        hpBarVisibleRemaining: Math.max(0, slot.state.hpBarVisibleRemaining - dt),
      };
    }
  }

  private stepPlayer(input: FrameInput, dt: number): void {
    const { config } = this;
    const entityDt = this.player.hitstopSteps > 0 ? 0 : dt;
    const stepInput: PlayerStepInput = {
      stick: input.stick,
      cameraYaw: this.camera.orbit.yaw,
      jump: input.jump,
      dash: input.dash,
      attack: input.attack,
      skill: input.skill,
      burst: input.burst,
      sprintHoldStart: input.sprintHoldStart,
      sprintHoldEnd: input.sprintHoldEnd,
      actionsAllowed: this.phase === 'playing',
    };
    const before = this.player;
    const r = stepPlayer(before, stepInput, this.deps.terrain, entityDt, config);
    this.player = r.player;
    if (
      this.player.name === 'attack' &&
      before.name !== 'attack' &&
      this.player.attack?.elapsed === 0
    ) {
      this.player = this.correctTarget(this.player);
    }
    for (const event of r.events) this.handlePlayerEvent(event);
    if (this.player.name === 'sprint' && entityDt > 0) {
      this.sprintSteps++;
      if (this.sprintSteps % SPRINT_DUST_INTERVAL_STEPS === 0)
        this.effect({ kind: 'sprintDust', position: this.player.position });
    }
  }

  /** 攻撃開始時のターゲット補正(F04): 正面 ±30 度・3 m 以内の最も近い敵へ向く。 */
  private correctTarget(player: PlayerState): PlayerState {
    const yaw = targetCorrectionYaw(
      player.position,
      player.yaw,
      this.enemies
        .filter((e) => isTargetable(e.state))
        .map((e) => ({ id: e.state.id, feet: e.state.position, hp: e.state.hp })),
      this.config.combat,
    );
    return yaw === null ? player : { ...player, yaw };
  }

  private handlePlayerEvent(event: PlayerEvent): void {
    const { config } = this;
    const p = this.player;
    switch (event.type) {
      case 'jumped':
        this.effect({ kind: 'jump', position: p.position });
        break;
      case 'landed': {
        const heavy = event.fallSpeed >= config.hitReaction.heavyLandingSpeed;
        this.effect({ kind: 'land', position: p.position, heavy });
        if (heavy) this.shake('landing');
        break;
      }
      case 'dashStarted':
        this.effect({ kind: 'dash', position: p.position, yaw: p.yaw });
        break;
      case 'attackStarted':
        this.onAttackStarted(event.kind);
        break;
      case 'attackActive':
        this.resolvePlayerAttack(
          event.kind,
          event.attackId,
          event.center,
          event.radius,
          event.damage,
        );
        break;
      case 'climbAttached':
        this.effect({ kind: 'climbAttach', position: p.position, wallNormal: event.wallNormal });
        break;
      case 'mantled':
        this.effect({ kind: 'mantle', position: p.position });
        break;
      case 'staminaDepleted':
        this.effect({ kind: 'staminaDepleted' });
        break;
      default:
        break;
    }
  }

  private onAttackStarted(kind: AttackKind): void {
    const p = this.player;
    const { config } = this;
    if (kind === 'skill') {
      this.skillCooldown = startCooldown(config.action.skillCooldown);
      this.effect({ kind: 'skillTelegraph', position: p.position });
      return;
    }
    if (kind === 'burst') {
      this.burstCooldown = startCooldown(config.action.burstCooldown);
      this.energy = spendAllEnergy(this.energy);
      this.effect({ kind: 'burstActivate', position: p.position });
      this.shake('burstActivate');
      return;
    }
    this.effect({ kind: 'attackSwing', attack: kind, position: p.position, yaw: p.yaw });
  }

  private resolvePlayerAttack(
    kind: AttackKind,
    attackId: number,
    center: Vec3,
    radius: number,
    damage: number,
  ): void {
    const { config } = this;
    const attack = this.player.attack;
    if (!attack || attack.attackId !== attackId) return;
    if (
      attack.hitTargets.length === 0 &&
      kind === 'skill' &&
      attack.elapsed <= config.combat.skill.startup + FIXED_STEP_SECONDS
    ) {
      this.effect({ kind: 'skillBurst', position: this.player.position });
    }
    if (this.attackerBudget?.attackId !== attackId)
      this.attackerBudget = createAttackerHitstopBudget(attackId);
    let hitTargets = attack.hitTargets;
    let attackerHitstop = 0;
    let shakeSpec: HitResolution['shake'] = null;
    let anyHit = false;
    for (const slot of this.enemies) {
      const enemy = slot.state;
      if (!isTargetable(enemy) || hitTargets.includes(enemy.id)) continue;
      const capsule: Capsule = {
        feet: enemy.position,
        radius: config.enemy.capsuleRadius,
        height: config.enemy.capsuleHeight,
      };
      if (!sphereCapsuleOverlap(center, radius, capsule)) continue;
      hitTargets = [...hitTargets, enemy.id];
      const resolution = resolveHit(
        {
          attackKind: kind,
          attackId,
          attackerId: 'player',
          victimId: enemy.id,
          damage,
          attackerCenter: playerCenter(this.player, config),
          victimCenter: enemyCenter(enemy, config.enemy),
          victimYaw: enemy.yaw,
          victimCategory: enemy.kind === 'dummy' ? 'enemyDummy' : 'enemyPatrol',
          victimInvincible: this.countdownActive,
          enemyStunAvailable: canEnemyBeStunned(enemy, this.worldTime, config.enemy),
        },
        config,
      );
      if (!resolution) continue;
      anyHit = true;
      slot.state = applyEnemyHit(enemy, resolution, this.worldTime, config);
      attackerHitstop = Math.max(attackerHitstop, resolution.hitstop.attacker);
      if (resolution.shake && (!shakeSpec || resolution.shake.amplitude > shakeSpec.amplitude))
        shakeSpec = resolution.shake;
      this.energy = gainEnergy(this.energy, resolution.energyGain);
      this.spawnDamage(
        enemy.id,
        resolution.damage,
        true,
        add(enemy.position, vec3(0, config.enemy.capsuleHeight, 0)),
      );
      this.effect({
        kind: 'hitSpark',
        attack: kind,
        position: closestPointOnCapsuleToSphere(center, capsule),
        victim: 'enemy',
      });
      this.effect({ kind: 'sound', name: `hit_${kind}` });
      if (isDefeated(slot.state)) this.onEnemyDefeated(slot.state);
    }
    this.player = { ...this.player, attack: { ...attack, hitTargets } };
    if (!anyHit) return;
    const applied = applyAttackerHitstop(
      this.player.hitstopSteps,
      attackerHitstop,
      this.attackerBudget,
      config.hitReaction,
    );
    this.attackerBudget = applied.budget;
    this.player = { ...this.player, hitstopSteps: applied.steps };
    this.camera = requestCameraShake(this.camera, shakeSpec, this.deps.rng, config);
  }

  private onEnemyDefeated(enemy: EnemyState): void {
    this.stats = recordDefeat(this.stats);
    this.effect({ kind: 'enemyDefeat', position: enemy.position, enemyId: enemy.id });
    this.shake('enemyDefeat');
  }

  private stepEnemies(dt: number): void {
    const { config } = this;
    const playerAlive = this.player.name !== 'dead';
    const center = playerCenter(this.player, config);
    for (const slot of this.enemies) {
      let enemy = slot.state;
      if (enemy.ai === 'dead') continue;
      const entityDt = enemy.hitstopSteps > 0 ? 0 : dt;
      if (entityDt > 0 && enemy.pending) enemy = releasePendingReactions(enemy);
      if (enemy.ai === 'dying') {
        slot.state = tickDeath(enemy, entityDt, config.enemy);
        continue;
      }
      const active = this.phase === 'playing' || this.phase === 'ending';
      const ai = stepEnemyAi(enemy, center, playerAlive && active, entityDt, config.enemy);
      enemy = ai.enemy;
      const moved = stepEnemyPhysics(enemy, slot.physics, entityDt, this.deps.terrain, config);
      slot.state = {
        ...moved.enemy,
        knockbackRemaining: Math.max(0, moved.enemy.knockbackRemaining - entityDt),
      };
      slot.physics = moved.physics;
      for (const event of ai.events) this.handleEnemyEvent(slot, event);
    }
  }

  private handleEnemyEvent(slot: EnemySlot, event: EnemyEvent): void {
    if (event.type === 'attackStart') this.effect({ kind: 'sound', name: 'enemy_telegraph' });
    if (event.type !== 'attackActive' || slot.state.attackHitDone) return;
    const { config } = this;
    const capsule: Capsule = {
      feet: this.player.position,
      radius: config.physics.playerCapsuleRadius,
      height: config.physics.playerCapsuleHeight,
    };
    if (!sphereCapsuleOverlap(event.sphereCenter, event.radius, capsule)) return;
    slot.state = { ...slot.state, attackHitDone: true };
    const category = hitCategoryOf(this.player.name, this.player.climb?.phase ?? null);
    const resolution = resolveHit(
      {
        attackKind: 'enemyAttack',
        attackId: event.attackId,
        attackerId: slot.state.id,
        victimId: 'player',
        damage: config.enemy.attackDamage,
        attackerCenter: enemyCenter(slot.state, config.enemy),
        victimCenter: playerCenter(this.player, config),
        victimYaw: this.player.yaw,
        victimCategory: category,
        victimInvincible: this.player.invincibleRemaining > 0 || this.countdownActive,
      },
      config,
    );
    if (!resolution) return;
    const applied = applyPlayerHit(this.player, resolution, this.player.climb?.wallNormal ?? null);
    this.player = applied.player;
    slot.state = {
      ...slot.state,
      hitstopSteps: requestHitstop(slot.state.hitstopSteps, resolution.hitstop.attacker),
    };
    this.stats = recordDamageTaken(this.stats, resolution.damage);
    this.playerFlash = startFlash('red', config.hitReaction);
    this.spawnDamage(
      'player',
      resolution.damage,
      false,
      add(this.player.position, vec3(0, config.physics.playerCapsuleHeight, 0)),
    );
    this.effect({
      kind: 'hitSpark',
      attack: 'enemyAttack',
      position: closestPointOnCapsuleToSphere(event.sphereCenter, capsule),
      victim: 'player',
    });
    this.effect({ kind: 'vibrate', ms: resolution.vibrationMs });
    this.effect({ kind: 'sound', name: 'player_hit' });
    if (applied.events.some((e) => e.type === 'died')) {
      this.effect({ kind: 'playerDefeat', position: this.player.position });
      this.shake('playerDefeat');
    } else {
      this.camera = requestCameraShake(this.camera, resolution.shake, this.deps.rng, config);
    }
  }

  private spawnDamage(
    targetId: number | 'player',
    amount: number,
    isPlayerAttack: boolean,
    anchor: Vec3,
  ): void {
    this.damageNumbers = spawnDamageNumber(
      this.damageNumbers,
      { targetId, amount, isPlayerAttack, anchor },
      this.config.hitReaction,
      this.nextDamageNumberId++,
    );
    if (targetId === 'player')
      this.lastPlayerDamage = this.damageNumbers[this.damageNumbers.length - 1] ?? null;
  }

  private separate(): void {
    const { config } = this;
    const playerSep = {
      position: this.player.position,
      radius: config.physics.playerCapsuleRadius,
      weight: config.physics.separationRatio,
      height: config.physics.playerCapsuleHeight,
    };
    const climbing = this.player.name === 'climb';
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      if (!a || !isTargetable(a.state)) continue;
      const aSep = {
        position: a.state.position,
        radius: config.enemy.capsuleRadius,
        weight: a.state.kind === 'dummy' ? 0 : config.physics.separationRatio,
        height: config.enemy.capsuleHeight,
      };
      if (!climbing) {
        const r = separatePair(playerSep, aSep);
        playerSep.position = r.a;
        a.state = { ...a.state, position: r.b };
        aSep.position = r.b;
      }
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        if (!b || !isTargetable(b.state)) continue;
        const bSep = {
          position: b.state.position,
          radius: config.enemy.capsuleRadius,
          weight: b.state.kind === 'dummy' ? 0 : config.physics.separationRatio,
          height: config.enemy.capsuleHeight,
        };
        const r = separatePair(aSep, bSep);
        a.state = { ...a.state, position: r.a };
        aSep.position = r.a;
        b.state = { ...b.state, position: r.b };
      }
    }
    this.player = { ...this.player, position: playerSep.position };
  }

  private stepInteract(input: FrameInput): void {
    if (!input.interact) return;
    const target = this.interactTarget();
    if (!target || !isGroundLocomotion(this.player.name)) return;
    this.interactMessage = showMessage(
      `${target.name}: 操作基盤の検証用ステージです`,
      this.config.action,
    );
    this.effect({ kind: 'interact', position: target.position });
  }

  private evaluateResult(dt: number): void {
    if (this.phase === 'ending') {
      this.endingRemaining -= dt;
      if (this.endingRemaining <= 0) this.phase = 'ended';
      return;
    }
    if (this.phase !== 'playing') return;
    const result = evaluateResult(
      this.player.hp,
      this.enemies.map((e) => ({
        isDefeatTarget: isDefeatTarget(e.state),
        defeated: isDefeated(e.state),
      })),
    );
    if (!result) return;
    this.result = result;
    this.stats = freezeStats(this.stats);
    this.phase = 'ending';
    this.endingRemaining = this.config.combat.resultDelay;
  }

  private shake(event: Parameters<typeof shakeForEvent>[0]): void {
    this.camera = requestCameraShake(
      this.camera,
      shakeForEvent(event, this.config.hitReaction),
      this.deps.rng,
      this.config,
    );
  }

  private effect(event: EffectEvent): void {
    this.deps.effects.trigger(event);
  }

  countdownLabel(): string | null {
    if (this.phase !== 'countdown') return null;
    const start = this.config.combat.countdownStartLabelSeconds;
    const r = this.countdownRemaining;
    if (r <= start) return 'START';
    return String(Math.ceil(r - start));
  }

  view(): ViewState {
    const { config } = this;
    const p = this.player;
    const player: PlayerView = {
      position: p.position,
      yaw: p.yaw,
      state: p.name,
      climbPhase: p.climb?.phase ?? null,
      velocity: p.velocity,
      flashOpacity: flashOpacity(this.playerFlash),
      visible: !this.camera.hidePlayer,
      hp: p.hp,
      maxHp: config.combat.playerMaxHp,
      stamina: p.stamina.value,
      staminaMax: config.stamina.max,
      staminaLow: isStaminaLow(p.stamina, config.stamina),
      defeatProgress:
        p.name === 'dead' ? Math.min(1, p.stateTime / config.hitReaction.playerDefeatAnimTime) : 0,
    };
    const enemies: EnemyView[] = this.enemies.map(({ state: e }) => ({
      id: e.id,
      kind: e.kind,
      position: e.position,
      yaw: e.yaw,
      hp: e.hp,
      maxHp: e.maxHp,
      flashIntensity: flashIntensity(e.flash),
      hpBarVisible: e.hpBarVisibleRemaining > 0 && isTargetable(e),
      death: isDefeated(e) ? deathProgress(e, config.enemy) : null,
      telegraphOpacity: telegraphOpacity(e, config.enemy),
      attacking: e.ai === 'attack' && !isTelegraphing(e, config.enemy),
      visible: e.ai !== 'dead',
    }));
    const damageNumbers: DamageNumberView[] = this.damageNumbers.map((n) => {
      const visual = damageNumberVisual(n, config.hitReaction);
      return {
        number: n,
        visual,
        worldPosition: add(n.worldPosition, vec3(0, visual.riseMeters, 0)),
      };
    });
    const recent = this.lastPlayerDamage
      ? (damageNumbers.find((d) => d.number.id === this.lastPlayerDamage?.id) ?? null)
      : null;
    const hud: HudView = {
      phase: this.phase,
      countdownLabel: this.countdownLabel(),
      buttons: this.buttonStates(),
      skillCooldownRatio: cooldownRatio(this.skillCooldown),
      skillCooldownLabel: remainingSecondsLabel(this.skillCooldown),
      energyRatio: energyRatio(this.energy),
      energyFull: isEnergyFull(this.energy),
      indicator: p.name === 'climb' ? 'climb' : p.name === 'glide' ? 'glide' : null,
      interactTargetName: this.interactTarget()?.name ?? null,
      interactMessage: this.interactMessage?.text ?? null,
      result: this.result,
      stats: this.stats,
      recentPlayerDamage: recent,
    };
    return {
      player,
      enemies,
      camera: {
        position: this.camera.position,
        lookAt: this.camera.lookAt,
        yaw: this.camera.orbit.yaw,
      },
      damageNumbers: damageNumbers.filter((d) => d.number.targetId !== 'player'),
      hud,
      worldTime: this.worldTime,
    };
  }
}

export { enemyCapsule, playerCapsule };
