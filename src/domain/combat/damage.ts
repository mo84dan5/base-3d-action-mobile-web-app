import type { GameConfig, HitstopSteps, ShakeSpec } from '../config/gameConfig';
import { scale, type Vec3 } from '../math/vec3';
import type { HitCategory } from '../player/playerState';
import {
  hitstopFor,
  hitstopForChargedShot,
  shakeForHit,
  type AttackKind,
} from '../hitReaction/hitTables';
import type { FlashColor } from '../hitReaction/hitFlash';
import { horizontalKnockbackDirection } from './hitGeometry';

// ダメージ処理(F04)とヒット時の処理フロー(F10)。ヒット確定後に何をどう適用するかを決める。
export type CombatantId = 'player' | number;
export type VictimCategory = HitCategory | 'enemyPatrol' | 'enemyDummy';

export interface HitRequest {
  readonly attackKind: AttackKind;
  readonly attackId: number;
  readonly attackerId: CombatantId;
  readonly victimId: CombatantId;
  readonly damage: number;
  readonly attackerCenter: Vec3;
  readonly victimCenter: Vec3;
  readonly victimYaw: number;
  readonly victimCategory: VictimCategory;
  readonly victimInvincible: boolean;
  /** 徘徊型の硬直を今回適用できるか(1.0 秒に 1 回。呼び出し側が判定) */
  readonly enemyStunAvailable?: boolean;
  /** タメ打ちのタメ率 0〜1(ヒットストップの長さに使う) */
  readonly chargeRatio?: number;
  /** スタイル定義(F11)からの上書き。無ければ攻撃種別の表を使う */
  readonly profile?: HitProfile;
}

/** スタイル定義が決めるヒットの性質(F11)。 */
export interface HitProfile {
  readonly knockbackSpeed: number;
  readonly energyGain: number;
  /** 硬直の秒数を上書きする(硬直付与・転倒)。undefined は既定 */
  readonly stunSeconds?: number;
  /** ヒットごとの攻撃側 HP 回復(吸収) */
  readonly heal?: number;
  /** 継続ダメージ(毎秒 × 秒) */
  readonly dot?: { readonly perSecond: number; readonly duration: number };
}

export type HitStateTransition = 'none' | 'toFall' | 'hitState';

export interface HitResolution {
  readonly damage: number;
  readonly hitstop: HitstopSteps;
  readonly flash: FlashColor;
  readonly applyStun: boolean;
  readonly stunSeconds: number;
  readonly invincibleSeconds: number;
  /** ノックバック速度ベクトル(水平)。適用しない場合は null */
  readonly knockback: Vec3 | null;
  readonly knockbackDecay: number;
  readonly stateTransition: HitStateTransition;
  /** Climb → Fall の際に面の法線方向へ与える初速(m/s)。それ以外は 0 */
  readonly detachSpeed: number;
  readonly shake: ShakeSpec | null;
  readonly energyGain: number;
  readonly vibrationMs: number;
  readonly heal: number;
  readonly dot: { readonly perSecond: number; readonly duration: number } | null;
}

export function hpAfterDamage(hp: number, damage: number): number {
  return Math.max(0, hp - damage);
}

export function isBigDamage(damage: number, config: GameConfig): boolean {
  return damage >= config.hitReaction.bigDamageThreshold;
}

function isIgnored(req: HitRequest): boolean {
  if (req.victimInvincible) return true;
  switch (req.victimCategory) {
    case 'burst':
    case 'invulnerableAnim':
    case 'dead':
      return true;
    default:
      return false;
  }
}

function knockbackSpeedFor(kind: AttackKind, config: GameConfig): number {
  switch (kind) {
    case 'skill':
      return config.combat.skill.knockbackSpeed;
    case 'strongAttack':
      return config.combat.strongAttack.knockbackSpeed;
    case 'shoot':
      return config.combat.shoot.knockbackSpeed;
    case 'chargedShot':
      return config.combat.chargedShot.knockbackSpeed;
    case 'burst':
      return 0;
    case 'enemyAttack':
      return config.combat.playerKnockbackSpeed;
    default:
      return config.combat.normalAttackKnockbackSpeed;
  }
}

function energyGainFor(kind: AttackKind, config: GameConfig): number {
  switch (kind) {
    case 'normal1':
    case 'normal2':
    case 'normal3':
    case 'airAttack':
      return config.action.energyPerNormalHit;
    case 'skill':
      return config.action.energyPerSkillHit;
    case 'strongAttack':
      return config.action.energyPerStrongAttackHit;
    case 'shoot':
      return config.action.energyPerShootHit;
    case 'chargedShot':
      return config.action.energyPerChargedShotHit;
    default:
      return 0;
  }
}

function knockbackVector(req: HitRequest, config: GameConfig): Vec3 | null {
  const speed = req.profile?.knockbackSpeed ?? knockbackSpeedFor(req.attackKind, config);
  if (speed <= 0) return null;
  const dir = horizontalKnockbackDirection(req.attackerCenter, req.victimCenter, req.victimYaw);
  return scale(dir, speed);
}

interface ReactionPolicy {
  readonly applyStun: boolean;
  readonly knockback: boolean;
  readonly invincible: boolean;
  readonly stateTransition: HitStateTransition;
  readonly detachSpeed: number;
}

function policyFor(req: HitRequest, config: GameConfig): ReactionPolicy {
  switch (req.victimCategory) {
    case 'enemyDummy':
      return {
        applyStun: false,
        knockback: false,
        invincible: false,
        stateTransition: 'none',
        detachSpeed: 0,
      };
    case 'enemyPatrol':
      return {
        applyStun: req.enemyStunAvailable === true,
        knockback: true,
        invincible: false,
        stateTransition: 'none',
        detachSpeed: 0,
      };
    case 'airborne':
      return {
        applyStun: false,
        knockback: false,
        invincible: true,
        stateTransition: 'none',
        detachSpeed: 0,
      };
    case 'climb':
      return {
        applyStun: false,
        knockback: false,
        invincible: true,
        stateTransition: 'toFall',
        detachSpeed: config.climb.hitDetachSpeed,
      };
    case 'glide':
      return {
        applyStun: false,
        knockback: false,
        invincible: true,
        stateTransition: 'toFall',
        detachSpeed: 0,
      };
    default:
      // grounded(Idle/Walk/Run/Sprint/Dash/Attack/Skill/Slide)
      return {
        applyStun: true,
        knockback: true,
        invincible: true,
        stateTransition: 'hitState',
        detachSpeed: 0,
      };
  }
}

/** null は無効(無敵・バースト・取り付き/よじ登り中・死亡)。フィードバックも出さない。 */
export function resolveHit(req: HitRequest, config: GameConfig): HitResolution | null {
  if (isIgnored(req)) return null;
  const victimIsPlayer = req.victimId === 'player';
  const policy = policyFor(req, config);
  const defaultStun = victimIsPlayer ? config.combat.playerHitStun : config.enemy.hitStun;
  const stunSeconds = req.profile?.stunSeconds ?? defaultStun;
  const forcedStun = req.profile?.stunSeconds !== undefined && !victimIsPlayer;
  const applyStun = (policy.applyStun || forcedStun) && req.victimCategory !== 'enemyDummy';
  return {
    damage: req.damage,
    hitstop:
      req.attackKind === 'chargedShot'
        ? hitstopForChargedShot(req.chargeRatio ?? 0, config.hitReaction)
        : hitstopFor(req.attackKind, config.hitReaction),
    flash: victimIsPlayer ? 'red' : 'white',
    applyStun,
    stunSeconds: applyStun ? stunSeconds : 0,
    invincibleSeconds: policy.invincible ? config.combat.playerInvincibleTime : 0,
    knockback: policy.knockback ? knockbackVector(req, config) : null,
    knockbackDecay: config.combat.knockbackDecayTime,
    stateTransition: policy.stateTransition,
    detachSpeed: policy.detachSpeed,
    shake: shakeForHit(req.attackKind, config.hitReaction),
    energyGain:
      req.attackerId === 'player'
        ? (req.profile?.energyGain ?? energyGainFor(req.attackKind, config))
        : 0,
    vibrationMs: victimIsPlayer ? config.action.playerHitVibrationMs : 0,
    heal: req.profile?.heal ?? 0,
    dot: req.profile?.dot ?? null,
  };
}
