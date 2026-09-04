import type { HitReactionConfig, HitstopSteps, ShakeSpec } from '../config/gameConfig';

// 攻撃種別ごとのヒットストップ長・カメラシェイクの表(F10)。
export type AttackKind =
  | 'normal1'
  | 'normal2'
  | 'normal3'
  | 'airAttack'
  | 'skill'
  | 'burst'
  | 'strongAttack'
  | 'shoot'
  | 'chargedShot'
  | 'enemyAttack';

export type ShakeEvent = 'playerHit' | 'enemyDefeat' | 'playerDefeat' | 'landing' | 'burstActivate';

export function hitstopFor(kind: AttackKind, config: HitReactionConfig): HitstopSteps {
  switch (kind) {
    case 'normal1':
    case 'normal2':
      return config.hitstop.normal12;
    case 'normal3':
      return config.hitstop.normal3;
    case 'airAttack':
      return config.hitstop.airAttack;
    case 'skill':
      return config.hitstop.skill;
    case 'burst':
      return config.hitstop.burst;
    case 'enemyAttack':
      return config.hitstop.enemyAttack;
    case 'strongAttack':
      return config.hitstop.strongAttack;
    case 'shoot':
      return config.hitstop.shoot;
    case 'chargedShot':
      return config.hitstop.chargedShotWeak;
  }
}

/** タメ打ちのヒットストップはタメ率で変わる(0.5 未満 / 以上)。 */
export function hitstopForChargedShot(
  chargeRatio: number,
  config: HitReactionConfig,
): HitstopSteps {
  return chargeRatio >= 0.5 ? config.hitstop.chargedShotStrong : config.hitstop.chargedShotWeak;
}

/** タメ打ち発射時のシェイク(ヒットの有無に関係なく)。振幅 0.04 + 0.08 × タメ率、持続 9〜12 ステップ。 */
export function shakeForChargedShot(chargeRatio: number, config: HitReactionConfig): ShakeSpec {
  const c = config.shake.chargedShot;
  const r = Math.min(1, Math.max(0, chargeRatio));
  return {
    amplitude: c.base + c.bonus * r,
    steps: Math.round(c.steps + (c.maxSteps - c.steps) * r),
  };
}

/** ヒット時のシェイク。通常攻撃 1・2 段はなし。敵の攻撃は「プレイヤー被弾」として shakeForEvent で扱う。 */
export function shakeForHit(kind: AttackKind, config: HitReactionConfig): ShakeSpec | null {
  switch (kind) {
    case 'normal1':
    case 'normal2':
      return null;
    case 'normal3':
      return config.shake.normal3;
    case 'airAttack':
      return config.shake.airAttack;
    case 'skill':
      return config.shake.skill;
    case 'burst':
      return null;
    case 'strongAttack':
      return config.shake.strongAttack;
    case 'shoot':
      return null;
    case 'chargedShot':
      // 発射時に shakeForChargedShot で 1 回だけ掛ける(ヒットごとには掛けない)
      return null;
    case 'enemyAttack':
      return config.shake.playerHit;
  }
}

export function shakeForEvent(event: ShakeEvent, config: HitReactionConfig): ShakeSpec {
  switch (event) {
    case 'playerHit':
      return config.shake.playerHit;
    case 'enemyDefeat':
      return config.shake.enemyDefeat;
    case 'playerDefeat':
      return config.shake.playerDefeat;
    case 'landing':
      return config.shake.landing;
    case 'burstActivate':
      return config.shake.burst;
  }
}
