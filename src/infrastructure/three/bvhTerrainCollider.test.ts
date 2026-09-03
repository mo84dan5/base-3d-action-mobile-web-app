import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../domain/config/gameConfig';
import { vec3 } from '../../domain/math/vec3';
import { classifySurface } from '../../domain/physics/surface';
import { stageLayout } from '../../domain/stage/stageLayout';
import { BvhTerrainCollider } from './bvhTerrainCollider';
import { buildStageGeometry } from './stageGeometry';

const stage = buildStageGeometry(stageLayout);
const terrain = new BvhTerrainCollider(stage.collision);
const capsule = { radius: 0.4, height: 1.7 };
const physics = defaultConfig.physics;

describe('BVH 地形コリジョン(F05)', () => {
  it('開始地点の真下は高さ 0 の歩行可能面', () => {
    const hit = terrain.raycast(vec3(0, 1, 0), vec3(0, -1, 0), 5);
    expect(hit?.point.y).toBeCloseTo(0, 5);
    expect(classifySurface(hit?.normal.y ?? 0, physics)).toBe('walkable');
  });
  it('崖(登攀可)の正面キャストは登攀可の壁に当たる', () => {
    const hit = terrain.raycast(vec3(0, 0.85, -18), vec3(0, 0, -1), 5);
    expect(hit).not.toBeNull();
    expect(hit?.unclimbable).toBe(false);
    expect(classifySurface(hit?.normal.y ?? 1, physics)).toBe('wall');
    expect(hit?.point.z).toBeCloseTo(-20, 3);
  });
  it('氷柱の側面は壁に分類され登攀不可、検証用の壁は登攀可', () => {
    const ice = terrain.raycast(vec3(7, 0.85, 0), vec3(0, 0, 1), 5);
    expect(ice?.unclimbable).toBe(true);
    expect(classifySurface(ice?.normal.y ?? 1, physics)).toBe('wall');
    const wall = terrain.raycast(vec3(-24, 0.85, 11), vec3(0, 0, 1), 5);
    expect(wall?.unclimbable).toBe(false);
  });
  it('緩い丘の斜面は歩行可能面(20 度)、急な坂は滑り面(45 度)', () => {
    const hill = terrain.raycast(vec3(-10, 5, 10), vec3(0, -1, 0), 10);
    expect(classifySurface(hill?.normal.y ?? 0, physics)).toBe('walkable');
    expect(hill?.normal.y).toBeCloseTo(Math.cos((20 * Math.PI) / 180), 3);
    const steep = terrain.raycast(vec3(12, 5, -10.5), vec3(0, -1, 0), 10);
    expect(classifySurface(steep?.normal.y ?? 0, physics)).toBe('slide');
  });
  it('地面にめり込んだカプセルは上へ押し出される', () => {
    const r = terrain.resolveCapsule(vec3(0, -0.2, 0), capsule);
    expect(r.position.y).toBeCloseTo(0, 3);
    expect(r.contacts[0]?.normal.y).toBeCloseTo(1, 3);
  });
  it('崖の壁にめり込んだカプセルは壁の法線方向へ押し出される', () => {
    const r = terrain.resolveCapsule(vec3(0, 0, -19.8), capsule);
    expect(r.position.z).toBeCloseTo(-19.6, 2);
    expect(r.contacts[0]?.normal.z).toBeCloseTo(1, 2);
  });
  it('段差 0.3 m の上面は高さ 0.3、1.0 m は高さ 1.0', () => {
    const s03 = terrain.raycast(vec3(-12, 2, -6), vec3(0, -1, 0), 5);
    expect(s03?.point.y).toBeCloseTo(0.3, 5);
    const s10 = terrain.raycast(vec3(-12, 2, -12), vec3(0, -1, 0), 5);
    expect(s10?.point.y).toBeCloseTo(1.0, 5);
  });
  it('外周の壁(透明)は ±30 m にあり登攀不可', () => {
    const hit = terrain.raycast(vec3(0, 1, 25), vec3(0, 0, 1), 10);
    expect(hit?.point.z).toBeCloseTo(30, 3);
    expect(hit?.unclimbable).toBe(true);
  });
  it('オーバーハングの張り出し下面は天井', () => {
    const hit = terrain.raycast(vec3(-22, 3, -1), vec3(0, 1, 0), 5);
    expect(classifySurface(hit?.normal.y ?? 0, physics)).toBe('ceiling');
  });
});
