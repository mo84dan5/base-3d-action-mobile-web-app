import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ProjectileView, ViewState } from '../../application/viewState';
import { StyleVisuals } from './styleVisuals';

// 発射体の形(デザインディレクション「武器別の言語」)。

function view(projectiles: ProjectileView[]): ViewState {
  return {
    player: { position: { x: 0, y: 0, z: 0 }, yaw: 0, guarding: false },
    projectiles,
    placed: [],
    summons: [],
  } as unknown as ViewState;
}

function projectile(styleId: string, extra: Partial<ProjectileView> = {}): ProjectileView {
  return {
    id: 1,
    position: { x: 0, y: 1, z: 3 },
    yaw: 0,
    radius: 0.3,
    styleId,
    returning: false,
    velocity: { x: 0, y: 0, z: 10 },
    ...extra,
  };
}

describe('StyleVisuals の発射体', () => {
  it('ブーメランは V 字の本体が水平に回転する', () => {
    const sv = new StyleVisuals(1.7);
    sv.sync(view([projectile('boomerang')]), 1 / 60);
    const root = sv.group.getObjectByName('vfx_projectile_boomerang');
    expect(root).toBeDefined();
    expect(sv.group.getObjectByName('vfx_projectile_body_boomerang')).toBeDefined();
    const first = root?.rotation.y ?? 0;
    sv.sync(view([projectile('boomerang')]), 1 / 60);
    expect(root?.rotation.y ?? 0).toBeGreaterThan(first);
    expect(root?.rotation.x ?? 1).toBe(0);
  });

  it('投槍は速度の向きに従い、落下中は下を向く', () => {
    const sv = new StyleVisuals(1.7);
    sv.sync(view([projectile('javelin', { velocity: { x: 0, y: -5, z: 5 } })]), 1 / 60);
    const root = sv.group.getObjectByName('vfx_projectile_javelin') as THREE.Group;
    expect(sv.group.getObjectByName('vfx_projectile_body_javelin')).toBeDefined();
    // ローカル +Z(穂先)がワールドで下向きになる
    const tip = new THREE.Vector3(0, 0, 1).applyEuler(root.rotation);
    expect(tip.y).toBeLessThan(-0.5);
  });

  it('ヨーヨーはプレイヤーとの間に糸を引き、消えると糸も消える', () => {
    const sv = new StyleVisuals(1.7);
    sv.sync(view([projectile('yoyo')]), 1 / 60);
    const line = sv.group.getObjectByName('vfx_projectile_string') as THREE.Mesh;
    expect(line).toBeDefined();
    expect(line.visible).toBe(true);
    expect(line.scale.y).toBeGreaterThan(2.5);
    sv.sync(view([]), 1 / 60);
    expect(sv.group.getObjectByName('vfx_projectile_string')).toBeUndefined();
  });

  it('形の指定がないスタイルは四面体', () => {
    const sv = new StyleVisuals(1.7);
    sv.sync(view([projectile('javelin_unknown_style')]), 1 / 60);
    expect(sv.group.getObjectByName('vfx_projectile_body_tetra')).toBeDefined();
  });
});
