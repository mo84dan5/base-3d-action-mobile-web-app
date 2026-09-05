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
  isEnergyFull,
  spendAllEnergy,
  spendEnergy,
  type Energy,
} from '../domain/action/energy';
import { resolveHit } from '../domain/combat/damage';
import {
  sphereCapsuleOverlap,
  closestPointOnCapsuleToSphere,
  nearestTargetsInCone,
  type Capsule,
} from '../domain/combat/hitGeometry';
import type { AttackStyleDefinition, TargetCone } from '../domain/attackStyle/actionSpec';
import { findAttackStyle } from '../domain/attackStyle/attackStyleCatalog';
import { resolveAttackStyleDetailed } from '../domain/attackStyle/styleResolver';
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
  createEnemy,
  deathProgress,
  enemyCenter,
  isDefeatTarget,
  isDefeated,
  isTargetable,
  pushEnemy,
  releasePendingReactions,
  stunEnemy,
  tickDeath,
  tickDot,
  type EnemyState,
} from '../domain/enemy/enemyState';
import {
  damageNumberVisual,
  spawnDamageNumber,
  tickDamageNumbers,
  type DamageNumber,
} from '../domain/hitReaction/damageNumbers';
import {
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
import { shakeForEvent } from '../domain/hitReaction/hitTables';
import {
  createSignboard,
  findInteractTarget,
  showMessage,
  tickMessage,
  type Interactable,
  type InteractMessage,
} from '../domain/interact/interactable';
import {
  add,
  directionFromYaw,
  distance,
  horizontal,
  normalize,
  scale,
  sub,
  vec3,
  type Vec3,
} from '../domain/math/vec3';
import { createPlayer } from '../domain/player/playerFactory';
import type { PlayerEvent } from '../domain/player/playerEvents';
import { guardCheck, guardSucceeded } from '../domain/player/actions/guardAction';
import { applyPlayerHit } from '../domain/player/playerHit';
import { enemyCapsule, playerCapsule } from '../domain/player/playerPhysics';
import {
  damageTakenMultiplier,
  findBuff,
  hitCategoryOf,
  isGroundLocomotion,
  type PlayerState,
} from '../domain/player/playerState';
import {
  cancelCharge,
  playerCenter,
  stepPlayer,
  type PlayerStepInput,
} from '../domain/player/playerStep';
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
import type { CombatHost, EnemySlot } from './combatHost';
import type { EffectEvent } from './effects';
import { stepEnemyPhysics } from './enemyPhysics';
import { PlacedSystem } from './placedSystem';
import { applyRayHit, applyVolumeHit, HitBatch } from './playerHits';
import { ProjectileSystem } from './projectileSystem';
import { SummonSystem } from './summonSystem';
import { accumulateFrameInput, EMPTY_FRAME_INPUT, type FrameInput } from './inputFrame';
import type { EffectPort, RandomSource } from './ports';
import { separatePair } from './separation';
import type {
  DamageNumberView,
  EnemyView,
  HudView,
  PlayerView,
  SessionPhase,
  StyleHudView,
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
const DOT_TICK_SECONDS = 0.5;
const HOLD_GRACE_STEPS = 2;

export class GameSession implements CombatHost {
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
  attackerBudget: AttackerHitstopBudget | null = null;
  readonly projectiles = new ProjectileSystem();
  readonly placed = new PlacedSystem();
  readonly summons = new SummonSystem();
  private readonly interactables: readonly Interactable[];
  private lastPlayerDamage: DamageNumber | null = null;
  private currentStyle: AttackStyleDefinition;
  private styleFallbackFrom: string | null = null;
  private rolledStyleId: string | null = null;
  private dotTimer = 0;

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
    this.currentStyle = resolveAttackStyleDetailed('melee').style;
  }

  get config(): GameConfig {
    return this.deps.config;
  }

  get terrain(): TerrainQuery {
    return this.deps.terrain;
  }

  get rng(): RandomSource {
    return this.deps.rng;
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
    const cancelled = cancelCharge(this.player);
    this.player = cancelled.player;
    for (const e of cancelled.events) this.handlePlayerEvent(e);
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
    this.stepPlayer(gated, dt, settings);
    this.projectiles.step(this, dt);
    this.placed.step(this, dt);
    this.summons.step(this, dt);
    this.stepEnemies(dt);
    this.separate();
    this.placed.blockEnemies(this);
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

  private stepPlayer(input: FrameInput, dt: number, settings: Settings): void {
    const { config } = this;
    const entityDt = this.player.hitstopSteps > 0 ? 0 : dt;
    const candidates = this.targetCandidates();
    const resolved = resolveAttackStyleDetailed(settings.attackStyle);
    const style = resolved.style;
    this.currentStyle = style;
    this.styleFallbackFrom = resolved.exact ? null : settings.attackStyle;
    const findTargets = (cone: TargetCone, max: number) =>
      nearestTargetsInCone(
        this.player.position,
        this.player.yaw,
        candidates,
        cone.halfAngleDeg,
        cone.range,
        max,
      );
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
      attackHoldStart: input.attackHoldStart,
      attackHoldEnd: input.attackHoldEnd,
      actionsAllowed: this.phase === 'playing',
      style,
      energy: this.energy.value,
      random: this.deps.rng(),
      findTarget: (cone) => findTargets(cone, 1)[0] ?? null,
      findTargets,
      wallAhead: (distance) => this.wallAhead(distance),
    };
    const before = this.player;
    const r = stepPlayer(before, stepInput, this.deps.terrain, entityDt, config);
    this.player = r.player;
    for (const event of r.events) this.handlePlayerEvent(event);
    if (this.player.name === 'sprint' && entityDt > 0) {
      this.sprintSteps++;
      if (this.sprintSteps % SPRINT_DUST_INTERVAL_STEPS === 0)
        this.effect({ kind: 'sprintDust', position: this.player.position });
    }
  }

  private targetCandidates() {
    return this.enemies
      .filter((e) => isTargetable(e.state))
      .map((e) => ({ id: e.state.id, feet: e.state.position, hp: e.state.hp }));
  }

  /** 正面 distance m 以内に壁(60 度以上の面)があるか(壁蹴り撃の条件)。 */
  private wallAhead(distance: number): boolean {
    const origin = playerCenter(this.player, this.config);
    const hit = this.deps.terrain.raycast(origin, directionFromYaw(this.player.yaw), distance);
    return hit !== null && hit.normal.y < Math.cos((60 * Math.PI) / 180);
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
        this.onAttackStarted(event);
        break;
      case 'attackActive':
        this.resolvePlayerAttack(event);
        break;
      case 'lungeStarted':
        this.effect({ kind: 'lunge', position: p.position, yaw: p.yaw });
        break;
      case 'shotFired':
        this.resolveShot(event);
        break;
      case 'projectileSpawned':
        this.projectiles.spawn(this, event);
        break;
      case 'objectPlaced':
        this.placed.place(this, event);
        break;
      case 'placedCommand':
        this.placed.command(this, event);
        break;
      case 'summoned':
        this.summons.summon(this, event);
        break;
      case 'summonCommand':
        this.summons.command(event);
        break;
      case 'guardStarted':
        this.effect({ kind: 'guard', phase: 'start', position: p.position, yaw: p.yaw });
        break;
      case 'guardEnded':
        this.effect({
          kind: 'guard',
          phase: event.reason === 'success' || event.reason === 'counter' ? 'success' : 'end',
          position: p.position,
          yaw: p.yaw,
        });
        break;
      case 'buffStarted':
        this.applyBuff(event);
        break;
      case 'pullTick':
        this.applyPull(event);
        break;
      case 'pullReleased':
        this.releasePull(event);
        break;
      case 'hpChanged':
        if (event.delta < 0) {
          this.stats = recordDamageTaken(this.stats, -event.delta);
          this.playerFlash = startFlash('red', config.hitReaction);
          this.spawnDamage(
            'player',
            -event.delta,
            false,
            add(p.position, vec3(0, config.physics.playerCapsuleHeight, 0)),
          );
          this.effect({ kind: 'selfDamage', position: p.position });
        }
        break;
      case 'energySpent':
        this.energy = spendEnergy(this.energy, event.amount);
        break;
      case 'maneuverStarted':
        this.effect({
          kind: 'maneuver',
          move: event.move,
          position: event.position,
          direction: event.direction,
        });
        break;
      case 'blinked':
        this.effect({ kind: 'blink', from: event.from, to: event.to });
        break;
      case 'styleRolled':
        this.rolledStyleId = event.styleId;
        break;
      case 'actionRejected':
        this.effect({ kind: 'sound', name: `rejected_${event.reason}` });
        break;
      case 'reloadStarted':
        this.effect({ kind: 'sound', name: 'reload' });
        break;
      case 'chargeStarted':
      case 'chargeCancelled':
        this.effect({ kind: 'sound', name: event.type });
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

  private onAttackStarted(event: Extract<PlayerEvent, { type: 'attackStarted' }>): void {
    const p = this.player;
    const { config } = this;
    const kind = event.kind;
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
    if (event.action === 'hitscan' || event.action === 'projectile') return;
    this.effect({
      kind: 'attackSwing',
      attack: kind,
      position: p.position,
      yaw: p.yaw,
      action: event.action,
      styleId: event.styleId,
    });
  }

  /** 多段ヒット(F11 N2)のティックには攻撃側ヒットストップを掛けない(連射の間隔を崩さない)。 */
  private attackerHitstopAllowed(): boolean {
    return this.player.action?.spec.kind !== 'multihit';
  }

  /** ヒットスキャン(射撃・タメ打ち・散弾・ビーム): 射線ごとに地形までを上限に敵カプセルと交差させる。 */
  private resolveShot(shot: Extract<PlayerEvent, { type: 'shotFired' }>): void {
    const results = applyRayHit(
      this,
      {
        kind: shot.kind,
        attackId: shot.attackId,
        damage: shot.damage,
        profile: shot.profile,
        chargeRatio: shot.chargeRatio,
        attackerHitstop: this.attackerHitstopAllowed(),
      },
      {
        origin: shot.origin,
        directions: shot.directions,
        range: shot.range,
        pierce: shot.pierce,
        beamWidth: shot.beamWidth,
        charged: shot.charged,
        chargeRatio: shot.chargeRatio,
      },
    );
    this.effect({ kind: 'muzzleFlash', position: shot.origin, yaw: this.player.yaw });
    for (const r of results) {
      this.effect({
        kind: 'tracer',
        from: shot.origin,
        to: r.end,
        charged: shot.charged || shot.beamWidth > 0,
        chargeRatio: shot.beamWidth > 0 ? Math.max(shot.chargeRatio, 0.5) : shot.chargeRatio,
      });
    }
  }

  private resolvePlayerAttack(event: Extract<PlayerEvent, { type: 'attackActive' }>): void {
    const { config } = this;
    const attack = this.player.attack;
    if (attack?.attackId !== event.attackId) return;
    if (
      attack.hitTargets.length === 0 &&
      event.kind === 'skill' &&
      attack.elapsed <= config.combat.skill.startup + FIXED_STEP_SECONDS
    ) {
      this.effect({ kind: 'skillBurst', position: this.player.position });
    }
    if (attack.hitTargets.length === 0 && event.volume.type !== 'sphere') {
      this.effect({
        kind: 'attackVolume',
        attack: event.kind,
        volume: event.volume,
        styleId: this.player.action?.styleId ?? null,
      });
    }
    const hitTargets = applyVolumeHit(
      this,
      {
        kind: event.kind,
        attackId: event.attackId,
        damage: event.damage,
        profile: event.profile,
        attackerHitstop: this.attackerHitstopAllowed(),
      },
      event.volume,
      attack.hitTargets,
    );
    const current = this.player.attack;
    if (current?.attackId === event.attackId) {
      this.player = { ...this.player, attack: { ...current, hitTargets } };
    }
  }

  /** 一時的な能力変化(F11 N10)のうち敵に及ぶもの: 時間停止・挑発。 */
  private applyBuff(event: Extract<PlayerEvent, { type: 'buffStarted' }>): void {
    const center = playerCenter(this.player, this.config);
    this.effect({
      kind: 'buff',
      effect: event.effect,
      position: event.position,
      radius: event.radius,
      duration: event.duration,
    });
    if (event.effect !== 'timeStop' && event.effect !== 'taunt') return;
    for (const slot of this.enemies) {
      if (!isTargetable(slot.state)) continue;
      if (distance(enemyCenter(slot.state, this.config.enemy), center) > event.radius) continue;
      if (event.effect === 'timeStop') {
        slot.state = { ...slot.state, frozenRemaining: event.duration, velocity: vec3(0, 0, 0) };
      } else {
        slot.state = {
          ...slot.state,
          tauntRemaining: event.duration,
          ai: slot.state.ai === 'idle' ? 'chase' : slot.state.ai,
          stateTime: slot.state.ai === 'idle' ? 0 : slot.state.stateTime,
        };
      }
    }
  }

  /** 引き寄せ・拘束(F11 N9): 対象を手元へ動かす、または手元に留める。 */
  private applyPull(event: Extract<PlayerEvent, { type: 'pullTick' }>): void {
    const slot = this.enemies.find((e) => e.state.id === event.targetId);
    if (!slot || !isTargetable(slot.state)) return;
    const to = horizontal(sub(event.towards, slot.state.position));
    const d = Math.hypot(to.x, to.z);
    if (event.hold) {
      slot.state = {
        ...slot.state,
        heldRemaining: HOLD_GRACE_STEPS * FIXED_STEP_SECONDS,
        velocity: vec3(0, 0, 0),
        position:
          d > 0.05
            ? vec3(event.towards.x, slot.state.position.y, event.towards.z)
            : slot.state.position,
      };
      this.effect({
        kind: 'pull',
        from: playerCenter(this.player, this.config),
        to: enemyCenter(slot.state, this.config.enemy),
        hold: true,
      });
      return;
    }
    if (d <= 0.1) return;
    const speed =
      event.speed > 0 ? Math.min(event.speed, d / FIXED_STEP_SECONDS) : d / FIXED_STEP_SECONDS;
    slot.state = {
      ...pushEnemy(slot.state, scale(normalize(to), speed), FIXED_STEP_SECONDS),
      heldRemaining: HOLD_GRACE_STEPS * FIXED_STEP_SECONDS,
    };
    this.effect({
      kind: 'pull',
      from: playerCenter(this.player, this.config),
      to: enemyCenter(slot.state, this.config.enemy),
      hold: false,
    });
  }

  private releasePull(event: Extract<PlayerEvent, { type: 'pullReleased' }>): void {
    const slot = this.enemies.find((e) => e.state.id === event.targetId);
    if (!slot || !isTargetable(slot.state)) return;
    slot.state = { ...slot.state, heldRemaining: 0 };
    const batch = new HitBatch(this, {
      kind: event.kind,
      attackId: event.attackId,
      damage: event.damage,
      profile: event.profile,
      attackerHitstop: true,
    });
    batch.hit(
      slot,
      enemyCenter(slot.state, this.config.enemy),
      playerCenter(this.player, this.config),
    );
    batch.finish();
    if (event.throwDirection && isTargetable(slot.state)) {
      // ノックバックは 0.3 秒で線形に 0 へ減るので、平均速度 × 減衰時間 = 距離になる速さで投げる
      const decay = this.config.combat.knockbackDecayTime;
      const speed = (2 * event.throwDistance) / decay;
      slot.state = {
        ...slot.state,
        pending: null,
        knockback: scale(event.throwDirection, speed),
        knockbackRemaining: decay,
        knockbackDecay: decay,
      };
    }
  }

  onEnemyDefeated(enemy: EnemyState): void {
    this.stats = recordDefeat(this.stats);
    this.effect({
      kind: 'enemyDefeat',
      position: enemy.position,
      enemyId: enemy.id,
      enemyKind: enemy.kind,
    });
    this.shake('enemyDefeat');
  }

  private stepEnemies(dt: number): void {
    const { config } = this;
    const playerAlive = this.player.name !== 'dead';
    const center = this.placed.decoyCenter() ?? playerCenter(this.player, config);
    this.dotTimer += dt;
    const dotTick = this.dotTimer >= DOT_TICK_SECONDS;
    if (dotTick) this.dotTimer -= DOT_TICK_SECONDS;
    for (const slot of this.enemies) {
      let enemy = slot.state;
      if (enemy.ai === 'dead') continue;
      enemy = this.tickStatus(slot, enemy, dt, dotTick);
      if (enemy.ai === 'dead' || enemy.frozenRemaining > 0) {
        slot.state = enemy;
        continue;
      }
      const entityDt = enemy.hitstopSteps > 0 ? 0 : dt;
      if (entityDt > 0 && enemy.pending) enemy = releasePendingReactions(enemy);
      if (enemy.ai === 'dying') {
        slot.state = tickDeath(enemy, entityDt, config.enemy);
        continue;
      }
      const active = this.phase === 'playing' || this.phase === 'ending';
      const held = enemy.heldRemaining > 0;
      const ai = held
        ? { enemy: { ...enemy, velocity: vec3(0, 0, 0) }, events: [] as readonly EnemyEvent[] }
        : stepEnemyAi(enemy, center, playerAlive && active, entityDt, config.enemy);
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

  /** 時間停止・拘束・挑発・継続ダメージ(F11 N8 / N9 / N10)をワールド時間で進める。 */
  private tickStatus(slot: EnemySlot, enemy: EnemyState, dt: number, dotTick: boolean): EnemyState {
    let next: EnemyState = {
      ...enemy,
      frozenRemaining: Math.max(0, enemy.frozenRemaining - dt),
      heldRemaining: Math.max(0, enemy.heldRemaining - dt),
      tauntRemaining: Math.max(0, enemy.tauntRemaining - dt),
    };
    if (next.tauntRemaining > 0 && next.ai === 'idle')
      next = { ...next, ai: 'chase', stateTime: 0 };
    if (!next.dot || !isTargetable(next)) return next;
    const ticked = tickDot(next, dotTick ? DOT_TICK_SECONDS : 0);
    next = ticked.enemy;
    if (ticked.damage > 0) {
      this.spawnDamage(
        next.id,
        ticked.damage,
        true,
        add(next.position, vec3(0, this.config.enemy.capsuleHeight, 0)),
      );
      next = { ...next, flash: startFlash('white', this.config.hitReaction) };
      if (next.hp <= 0) {
        next =
          next.kind === 'dummy'
            ? { ...next, hp: next.maxHp }
            : {
                ...next,
                ai: 'dying',
                stateTime: 0,
                velocity: vec3(0, 0, 0),
                deathTime: 0,
                pending: null,
                dot: null,
              };
        if (isDefeated(next)) {
          slot.state = next;
          this.onEnemyDefeated(next);
        }
      }
    }
    return next;
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
    const attackerCenter = enemyCenter(slot.state, config.enemy);
    const guard = guardCheck(this.player, attackerCenter);
    if (guard.blocked && guard.spec) {
      this.onGuardBlocked(slot, guard.spec, guard.reduction);
      if (guard.reduction >= 1) return;
    }
    const category = hitCategoryOf(
      this.player.name,
      this.player.climb?.phase ?? null,
      this.player.grounded,
    );
    const multiplier =
      damageTakenMultiplier(this.player) * (guard.blocked ? 1 - guard.reduction : 1);
    const resolution = resolveHit(
      {
        attackKind: 'enemyAttack',
        attackId: event.attackId,
        attackerId: slot.state.id,
        victimId: 'player',
        damage: Math.max(0, Math.round(config.enemy.attackDamage * multiplier)),
        attackerCenter,
        victimCenter: playerCenter(this.player, config),
        victimYaw: this.player.yaw,
        victimCategory: category,
        victimInvincible: this.player.invincibleRemaining > 0 || this.countdownActive,
      },
      config,
    );
    if (!resolution) return;
    // ガードで軽減した被弾は硬直・ノックバックを受けない(反射盾・反撃姿勢)
    const softened = guard.blocked
      ? {
          ...resolution,
          applyStun: false,
          stunSeconds: 0,
          knockback: null,
          stateTransition: 'none' as const,
          hitstop: { attacker: resolution.hitstop.attacker, victim: 0 },
        }
      : resolution;
    const applied = applyPlayerHit(this.player, softened, this.player.climb?.wallNormal ?? null);
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

  /** ガード成功(F11 N5): 成功を記録し、転倒・反射を敵へ適用する。カウンターは次ステップで player 側が始める。 */
  private onGuardBlocked(
    slot: EnemySlot,
    spec: Extract<PlayerEvent, { type: 'guardStarted' }>['spec'],
    reduction: number,
  ): void {
    this.player = guardSucceeded(this.player);
    this.effect({
      kind: 'guard',
      phase: 'success',
      position: this.player.position,
      yaw: this.player.yaw,
    });
    this.effect({ kind: 'sound', name: reduction >= 1 ? 'guard_block' : 'guard_soft' });
    if (spec.onSuccess === 'topple' && spec.toppleSeconds > 0) {
      slot.state = stunEnemy(slot.state, spec.toppleSeconds);
      slot.state = { ...slot.state, lastStunTime: this.worldTime };
    }
    if (spec.onSuccess === 'reflect') {
      const batch = new HitBatch(this, {
        kind: 'medium',
        attackId: this.player.attack?.attackId ?? 0,
        damage: this.config.enemy.attackDamage,
        profile: { knockbackSpeed: 3.0, energyGain: 5 },
        attackerHitstop: false,
      });
      batch.hit(
        slot,
        enemyCenter(slot.state, this.config.enemy),
        playerCenter(this.player, this.config),
      );
      batch.finish();
    }
  }

  spawnDamage(
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

  effect(event: EffectEvent): void {
    this.deps.effects.trigger(event);
  }

  private chargeRatio(): number {
    const p = this.player;
    if (p.name !== 'charge' || p.action?.spec.kind !== 'charge') return 0;
    return Math.min(1, p.chargeTime / p.action.spec.maxTime);
  }

  private styleHud(): StyleHudView {
    const p = this.player;
    const style = this.currentStyle;
    const rolled = this.rolledStyleId ? findAttackStyle(this.rolledStyleId) : null;
    const momentum = findBuff(p, 'momentum');
    const rhythm = findBuff(p, 'rhythm');
    return {
      id: style.id,
      name: style.name,
      category: style.category,
      fallbackFrom: this.styleFallbackFrom,
      rolledName: style.id === 'roulette' && rolled ? rolled.name : null,
      ammo: p.ammo
        ? {
            remaining: p.ammo.remaining,
            capacity: p.ammo.capacity,
            reloading: p.ammo.reloadRemaining > 0,
          }
        : null,
      hitCount: momentum ? momentum.stacks : null,
      beat:
        rhythm && rhythm.beatSeconds > 0
          ? (rhythm.beatTime % rhythm.beatSeconds) / rhythm.beatSeconds
          : null,
      guarding: p.name === 'guard' && p.action?.phase === 'guard',
    };
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
      chargeRatio: this.chargeRatio(),
      styleId: this.currentStyle.id,
      styleCategory: this.currentStyle.category,
      guarding: p.name === 'guard' && p.action?.phase === 'guard',
      chargeCameraDistance:
        p.name === 'charge' && p.action?.spec.kind === 'charge'
          ? (p.action.spec.cameraDistance ?? null)
          : null,
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
      chargeRatio: this.chargeRatio(),
      indicator: p.name === 'climb' ? 'climb' : p.name === 'glide' ? 'glide' : null,
      interactTargetName: this.interactTarget()?.name ?? null,
      interactTargetPosition: this.interactTarget()?.position ?? null,
      interactMessage: this.interactMessage?.text ?? null,
      result: this.result,
      stats: this.stats,
      recentPlayerDamage: recent,
      style: this.styleHud(),
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
      projectiles: this.projectiles.view(),
      placed: this.placed.view(),
      summons: this.summons.view(),
      hud,
      worldTime: this.worldTime,
    };
  }
}

export { enemyCapsule, playerCapsule };
