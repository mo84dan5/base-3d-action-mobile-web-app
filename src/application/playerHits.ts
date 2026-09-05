import { gainEnergy } from '../domain/action/energy';
import { resolveHit, type HitProfile, type HitResolution } from '../domain/combat/damage';
import { rayCapsuleDistance, type Capsule } from '../domain/combat/hitGeometry';
import {
  volumeCapsuleOverlap,
  volumeContactPoint,
  type HitVolume,
} from '../domain/combat/hitVolume';
import {
  applyDot,
  applyEnemyHit,
  canEnemyBeStunned,
  enemyCenter,
  isDefeated,
  isTargetable,
} from '../domain/enemy/enemyState';
import {
  applyAttackerHitstop,
  createAttackerHitstopBudget,
} from '../domain/hitReaction/entityTime';
import { shakeForChargedShot, type AttackKind } from '../domain/hitReaction/hitTables';
import { add, scale, vec3, type Vec3 } from '../domain/math/vec3';
import { playerCenter, recordPlayerHit } from '../domain/player/playerStep';
import { requestCameraShake } from './cameraRig';
import type { CombatHost, EnemySlot } from './combatHost';

// プレイヤー側(本体・発射体・設置物・召喚体)の攻撃を敵へ適用する(F04 / F10 / F11)。

export interface HitSource {
  readonly kind: AttackKind;
  readonly attackId: number;
  readonly damage: number;
  readonly profile: HitProfile | null;
  readonly chargeRatio?: number;
  /** 攻撃側ヒットストップをプレイヤーに掛けるか(本体の攻撃のみ) */
  readonly attackerHitstop: boolean;
}

/** 同一ステップ内の複数ヒットをまとめ、攻撃側ヒットストップとシェイクを 1 回だけ掛ける。 */
export class HitBatch {
  attackerHitstop = 0;
  shake: HitResolution['shake'] = null;
  anyHit = false;

  constructor(
    private readonly host: CombatHost,
    private readonly source: HitSource,
  ) {}

  hit(slot: EnemySlot, contact: Vec3, attackerCenter: Vec3): HitResolution | null {
    const { host, source } = this;
    const { config } = host;
    const enemy = slot.state;
    const resolution = resolveHit(
      {
        attackKind: source.kind,
        attackId: source.attackId,
        attackerId: 'player',
        victimId: enemy.id,
        damage: Math.round(source.damage),
        attackerCenter,
        victimCenter: enemyCenter(enemy, config.enemy),
        victimYaw: enemy.yaw,
        victimCategory: enemy.kind === 'dummy' ? 'enemyDummy' : 'enemyPatrol',
        victimInvincible: host.countdownActive,
        enemyStunAvailable: canEnemyBeStunned(enemy, host.worldTime, config.enemy),
        ...(source.chargeRatio !== undefined ? { chargeRatio: source.chargeRatio } : {}),
        ...(source.profile ? { profile: source.profile } : {}),
      },
      config,
    );
    if (!resolution) return null;
    this.anyHit = true;
    let next = applyEnemyHit(enemy, resolution, host.worldTime, config);
    if (resolution.dot) next = applyDot(next, resolution.dot.perSecond, resolution.dot.duration);
    slot.state = next;
    this.attackerHitstop = Math.max(this.attackerHitstop, resolution.hitstop.attacker);
    if (resolution.shake && (!this.shake || resolution.shake.amplitude > this.shake.amplitude)) {
      this.shake = resolution.shake;
    }
    host.energy = gainEnergy(host.energy, resolution.energyGain);
    if (resolution.heal > 0) {
      host.player = {
        ...host.player,
        hp: Math.min(config.combat.playerMaxHp, host.player.hp + resolution.heal),
      };
    }
    host.player = recordPlayerHit(host.player);
    host.spawnDamage(
      enemy.id,
      resolution.damage,
      true,
      add(enemy.position, vec3(0, config.enemy.capsuleHeight, 0)),
    );
    host.effect({ kind: 'hitSpark', attack: source.kind, position: contact, victim: 'enemy' });
    host.effect({ kind: 'sound', name: `hit_${source.kind}` });
    if (isDefeated(slot.state)) host.onEnemyDefeated(slot.state);
    return resolution;
  }

  finish(): void {
    const { host, source } = this;
    if (!this.anyHit) return;
    if (source.attackerHitstop) {
      if (host.attackerBudget?.attackId !== source.attackId) {
        host.attackerBudget = createAttackerHitstopBudget(source.attackId);
      }
      const applied = applyAttackerHitstop(
        host.player.hitstopSteps,
        this.attackerHitstop,
        host.attackerBudget,
        host.config.hitReaction,
      );
      host.attackerBudget = applied.budget;
      host.player = { ...host.player, hitstopSteps: applied.steps };
    }
    if (this.shake)
      host.camera = requestCameraShake(host.camera, this.shake, host.rng, host.config);
  }
}

export function enemyCapsuleOf(host: CombatHost, slot: EnemySlot): Capsule {
  return {
    feet: slot.state.position,
    radius: host.config.enemy.capsuleRadius,
    height: host.config.enemy.capsuleHeight,
  };
}

/** 体積に重なる敵(未ヒットのもの)へ当てる。ヒットした敵 ID を加えた一覧を返す。 */
export function applyVolumeHit(
  host: CombatHost,
  source: HitSource,
  volume: HitVolume,
  hitTargets: readonly number[],
  attackerCenter: Vec3 = playerCenter(host.player, host.config),
): readonly number[] {
  const batch = new HitBatch(host, source);
  let targets = hitTargets;
  for (const slot of host.enemies) {
    const enemy = slot.state;
    if (!isTargetable(enemy) || targets.includes(enemy.id)) continue;
    const capsule = enemyCapsuleOf(host, slot);
    if (!volumeCapsuleOverlap(volume, capsule)) continue;
    targets = [...targets, enemy.id];
    batch.hit(slot, volumeContactPoint(volume, capsule), attackerCenter);
  }
  batch.finish();
  return targets;
}

export interface RayShot {
  readonly origin: Vec3;
  readonly directions: readonly Vec3[];
  readonly range: number;
  readonly pierce: boolean;
  readonly beamWidth: number;
  readonly charged: boolean;
  readonly chargeRatio: number;
}

export interface RayResult {
  readonly direction: Vec3;
  readonly end: Vec3;
}

/** 射線ごとに地形までの距離を上限として敵カプセルとの交差を求め、当てる。 */
export function applyRayHit(
  host: CombatHost,
  source: HitSource,
  shot: RayShot,
  attackerCenter: Vec3 = playerCenter(host.player, host.config),
): RayResult[] {
  const batch = new HitBatch(host, source);
  const results: RayResult[] = [];
  const hitOnce = new Set<number>();
  for (const direction of shot.directions) {
    const terrainHit = host.terrain.raycast(shot.origin, direction, shot.range);
    const maxDistance = terrainHit ? terrainHit.distance : shot.range;
    const hits = host.enemies
      .filter((slot) => isTargetable(slot.state) && !hitOnce.has(slot.state.id))
      .map((slot) => {
        const capsule = enemyCapsuleOf(host, slot);
        const inflated: Capsule = { ...capsule, radius: capsule.radius + shot.beamWidth / 2 };
        return { slot, t: rayCapsuleDistance(shot.origin, direction, maxDistance, inflated) };
      })
      .filter((h): h is { slot: EnemySlot; t: number } => h.t !== null)
      .sort((a, b) => a.t - b.t);
    const targets = shot.pierce ? hits : hits.slice(0, 1);
    const endDistance = !shot.pierce && targets[0] ? targets[0].t : maxDistance;
    results.push({ direction, end: add(shot.origin, scale(direction, endDistance)) });
    for (const { slot, t } of targets) {
      hitOnce.add(slot.state.id);
      batch.hit(slot, add(shot.origin, scale(direction, t)), attackerCenter);
    }
  }
  if (shot.charged && source.attackerHitstop) {
    host.camera = requestCameraShake(
      host.camera,
      shakeForChargedShot(shot.chargeRatio, host.config.hitReaction),
      host.rng,
      host.config,
    );
  }
  batch.finish();
  return results;
}
