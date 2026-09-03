import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../domain/config/gameConfig';
import { createEnemy } from '../domain/enemy/enemyState';
import { vec3 } from '../domain/math/vec3';
import { AnalyticTerrain } from '../domain/terrain/analyticTerrain';
import { stepEnemyPhysics } from './enemyPhysics';

const config = defaultConfig;
const DT = 1 / 60;

describe('敵の地形移動(F04)', () => {
  it('平地では AI の速度どおりに進む', () => {
    const terrain = AnalyticTerrain.flatGround();
    let enemy = {
      ...createEnemy(1, 'patrol', vec3(0, 0, 0), config.enemy),
      velocity: vec3(0, 0, 2),
    };
    let physics = { verticalVelocity: 0 };
    for (let i = 0; i < 60; i++)
      ({ enemy, physics } = stepEnemyPhysics(enemy, physics, DT, terrain, config));
    expect(enemy.position.z).toBeCloseTo(2, 1);
    expect(enemy.grounded).toBe(true);
  });
  it('壁に当たると壁ずりせずに停止する', () => {
    const terrain = AnalyticTerrain.flatGround([
      { kind: 'box', min: vec3(-10, 0, 2), max: vec3(10, 3, 4), unclimbable: true },
    ]);
    let enemy = {
      ...createEnemy(1, 'patrol', vec3(0, 0, 1.4), config.enemy),
      velocity: vec3(1.4, 0, 1.4),
    };
    let physics = { verticalVelocity: 0 };
    for (let i = 0; i < 30; i++)
      ({ enemy, physics } = stepEnemyPhysics(enemy, physics, DT, terrain, config));
    expect(enemy.position.z).toBeLessThanOrEqual(1.5 + 1e-6);
    expect(Math.abs(enemy.position.x)).toBeLessThan(0.2);
    expect(enemy.velocity).toEqual(vec3(0, 0, 0));
  });
  it('接地を失うと重力で落下し、着地で接地に戻る', () => {
    const terrain = AnalyticTerrain.flatGround([
      { kind: 'box', min: vec3(-5, 0, -5), max: vec3(5, 2, 0) },
    ]);
    let enemy = {
      ...createEnemy(1, 'patrol', vec3(0, 2, -0.3), config.enemy),
      velocity: vec3(0, 0, 2),
    };
    let physics = { verticalVelocity: 0 };
    for (let i = 0; i < 90; i++)
      ({ enemy, physics } = stepEnemyPhysics(enemy, physics, DT, terrain, config));
    expect(enemy.position.y).toBeCloseTo(0, 1);
    expect(enemy.grounded).toBe(true);
  });
});
