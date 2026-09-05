import type { Energy } from '../domain/action/energy';
import type { GameConfig } from '../domain/config/gameConfig';
import type { EnemyState } from '../domain/enemy/enemyState';
import type { DamageNumber } from '../domain/hitReaction/damageNumbers';
import type { AttackerHitstopBudget } from '../domain/hitReaction/entityTime';
import type { Vec3 } from '../domain/math/vec3';
import type { PlayerState } from '../domain/player/playerState';
import type { TerrainQuery } from '../domain/terrain/terrainQuery';
import type { CameraRigState } from './cameraRig';
import type { EffectEvent } from './effects';
import type { EnemyPhysicsState } from './enemyPhysics';
import type { RandomSource } from './ports';

// 戦闘処理(ヒット適用・発射体・設置物・召喚体)がセッションに求めるもの。GameSession が満たす。

export interface EnemySlot {
  state: EnemyState;
  physics: EnemyPhysicsState;
}

export interface CombatHost {
  readonly config: GameConfig;
  readonly terrain: TerrainQuery;
  readonly rng: RandomSource;
  player: PlayerState;
  energy: Energy;
  camera: CameraRigState;
  enemies: EnemySlot[];
  attackerBudget: AttackerHitstopBudget | null;
  damageNumbers: readonly DamageNumber[];
  readonly worldTime: number;
  readonly countdownActive: boolean;
  effect(event: EffectEvent): void;
  spawnDamage(
    targetId: number | 'player',
    amount: number,
    isPlayerAttack: boolean,
    anchor: Vec3,
  ): void;
  onEnemyDefeated(enemy: EnemyState): void;
}
