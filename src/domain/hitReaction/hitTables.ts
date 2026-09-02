import type { HitReactionConfig, HitstopSteps, ShakeSpec } from '../config/gameConfig';

// 攻撃種別ごとのヒットストップ長・カメラシェイクの表(F10)。
export type AttackKind =
  'normal1' | 'normal2' | 'normal3' | 'airAttack' | 'skill' | 'burst' | 'enemyAttack';

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
  }
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
