import type { GameConfig } from '../domain/config/gameConfig';
import { currentKnockback, type EnemyState } from '../domain/enemy/enemyState';
import { add, vec3, type Vec3 } from '../domain/math/vec3';
import { integrateGravity } from '../domain/physics/surface';
import { enemyCapsule, moveInAir, moveOnGround } from '../domain/player/playerPhysics';
import type { TerrainQuery } from '../domain/terrain/terrainQuery';

// 敵の地形上の移動(F04: 接地判定に従い移動、滑り面・壁には進入せず停止、ノックバックは重力・コリジョンの対象)。

export interface EnemyPhysicsState {
  readonly verticalVelocity: number;
}

export function stepEnemyPhysics(
  enemy: EnemyState,
  physics: EnemyPhysicsState,
  dt: number,
  terrain: TerrainQuery,
  config: GameConfig,
): { enemy: EnemyState; physics: EnemyPhysicsState } {
  if (dt <= 0) return { enemy, physics };
  const shape = enemyCapsule(config);
  const horizontal: Vec3 = add(enemy.velocity, currentKnockback(enemy));
  if (enemy.grounded) {
    const r = moveOnGround(enemy.position, horizontal, dt, shape, terrain, config);
    if (r.ground.kind === 'slide') {
      // 滑り面には進入せず停止する
      return { enemy: { ...enemy, velocity: vec3(0, 0, 0) }, physics };
    }
    if (r.ground.kind === 'none') {
      return {
        enemy: { ...enemy, position: r.position, grounded: false },
        physics: { verticalVelocity: 0 },
      };
    }
    return { enemy: { ...enemy, position: r.position }, physics };
  }
  const vy = integrateGravity(physics.verticalVelocity, dt, config.physics);
  const r = moveInAir(
    enemy.position,
    vec3(horizontal.x, vy, horizontal.z),
    dt,
    shape,
    terrain,
    config,
  );
  if (r.ground.kind !== 'none') {
    return {
      enemy: { ...enemy, position: r.position, grounded: true },
      physics: { verticalVelocity: 0 },
    };
  }
  return { enemy: { ...enemy, position: r.position }, physics: { verticalVelocity: vy } };
}
