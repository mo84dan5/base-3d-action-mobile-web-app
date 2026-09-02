import { describe, expect, it } from 'vitest';
import { vec3 } from '../math/vec3';
import { AnalyticTerrain } from './analyticTerrain';

const capsule = { radius: 0.4, height: 1.7 };

describe('AnalyticTerrain(テスト用の解析地形)', () => {
  it('平地へ真下にレイキャストすると距離 1.0 で当たる', () => {
    const t = AnalyticTerrain.flatGround();
    const hit = t.raycast(vec3(0, 1, 0), vec3(0, -1, 0), 5);
    expect(hit?.distance).toBeCloseTo(1);
    expect(hit?.normal.y).toBe(1);
  });
  it('箱の側面に正面からレイキャストすると法線が手前を向く', () => {
    const t = new AnalyticTerrain([
      { kind: 'box', min: vec3(-1, 0, 2), max: vec3(1, 3, 4), unclimbable: true },
    ]);
    const hit = t.raycast(vec3(0, 1, 0), vec3(0, 0, 1), 5);
    expect(hit?.distance).toBeCloseTo(2);
    expect(hit?.normal.z).toBe(-1);
    expect(hit?.unclimbable).toBe(true);
  });
  it('地面にめり込んだカプセルは上へ押し出される', () => {
    const t = AnalyticTerrain.flatGround();
    const r = t.resolveCapsule(vec3(0, -0.2, 0), capsule);
    expect(r.position.y).toBeCloseTo(0);
    expect(r.contacts[0]?.normal.y).toBe(1);
  });
  it('箱にめり込んだカプセルは側面の法線方向へ押し出される', () => {
    const t = new AnalyticTerrain([{ kind: 'box', min: vec3(0, 0, 2), max: vec3(4, 3, 6) }]);
    const r = t.resolveCapsule(vec3(2, 0, 1.8), capsule);
    expect(r.position.z).toBeCloseTo(1.6);
    expect(r.contacts[0]?.normal.z).toBe(-1);
  });
  it('接触していないカプセルは動かない', () => {
    const t = AnalyticTerrain.flatGround();
    const r = t.resolveCapsule(vec3(0, 0.5, 0), capsule);
    expect(r.position.y).toBe(0.5);
    expect(r.contacts).toHaveLength(0);
  });
});
