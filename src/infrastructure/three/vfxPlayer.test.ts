import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../domain/config/gameConfig';
import { VfxPlayer, slashOrientation } from './vfxPlayer';

// 斬撃の板が「振りの軌跡の面」に置かれることを検証する(デザインディレクション エフェクト「斬撃」)。
const normalOf = (q: THREE.Quaternion) => new THREE.Vector3(0, 0, 1).applyQuaternion(q);
const arcCenterOf = (q: THREE.Quaternion) => new THREE.Vector3(1, 0, 0).applyQuaternion(q);

describe('slashOrientation', () => {
  it('水平斬り(roll 0)は板の法線が上を向き、弧の中心が前方(yaw 0 = +z)を向く', () => {
    const q = slashOrientation(0, 0);
    const n = normalOf(q);
    expect(n.y).toBeCloseTo(1, 5);
    const c = arcCenterOf(q);
    expect(c.z).toBeCloseTo(1, 5);
  });
  it('縦斬り(roll 90 度)は板が前方を含む鉛直面になる(法線が水平で前方に直交)', () => {
    const q = slashOrientation(0, Math.PI / 2);
    const n = normalOf(q);
    expect(Math.abs(n.y)).toBeLessThan(1e-5);
    expect(Math.abs(n.z)).toBeLessThan(1e-5);
    expect(arcCenterOf(q).z).toBeCloseTo(1, 5);
  });
  it('斜め斬り(roll 45 度)は法線が 45 度傾く', () => {
    const n = normalOf(slashOrientation(0, Math.PI / 4));
    expect(n.y).toBeCloseTo(Math.SQRT1_2, 5);
  });
  it('yaw π/2 では弧の中心が +x を向き、水平斬りの法線は上のまま', () => {
    const q = slashOrientation(Math.PI / 2, 0);
    expect(arcCenterOf(q).x).toBeCloseTo(1, 5);
    expect(normalOf(q).y).toBeCloseTo(1, 5);
  });
});

describe('VfxPlayer の斬撃', () => {
  it('攻撃の振りで斬撃メッシュがプレイヤー中心の高さに置かれ、正面を向く板にならない', () => {
    const vfx = new VfxPlayer(defaultConfig, 'medium', new THREE.CapsuleGeometry(0.4, 0.9));
    vfx.trigger({
      kind: 'attackSwing',
      attack: 'normal3',
      position: { x: 2, y: 0, z: 3 },
      yaw: 0,
      action: 'combo',
      styleId: 'melee',
      shape: 'sphere',
    });
    const mesh = vfx.group.getObjectByName('vfx_normal3_slash_1.6') as THREE.Mesh | undefined;
    expect(mesh).toBeDefined();
    if (!mesh) return;
    expect(mesh.visible).toBe(true);
    expect(mesh.position.y).toBeCloseTo(0.85, 5);
    expect(mesh.position.z).toBeCloseTo(3, 5);
    expect(normalOf(mesh.quaternion).y).toBeCloseTo(1, 5);
  });
});

describe('VfxPlayer の武器別の言語(射線)', () => {
  const make = () => new VfxPlayer(defaultConfig, 'medium', new THREE.CapsuleGeometry(0.4, 0.9));
  const from = { x: 0, y: 0.85, z: 0 };
  const to = { x: 0, y: 0.85, z: 8 };
  const shoot = (vfx: VfxPlayer, styleId: string, charged = false) => {
    vfx.trigger({ kind: 'muzzleFlash', position: from, yaw: 0, styleId });
    vfx.trigger({ kind: 'tracer', from, to, charged, chargeRatio: charged ? 1 : 0, styleId });
  };
  const names = (vfx: VfxPlayer) => {
    const out: string[] = [];
    vfx.group.traverse((o) => {
      if (o.visible && o.name.startsWith('vfx_')) out.push(o.name);
    });
    return out;
  };

  it('弓は矢の形が射線上を飛び、弾道線を出さない', () => {
    const vfx = make();
    shoot(vfx, 'bow');
    const n = names(vfx);
    expect(n).toContain('vfx_arrow');
    expect(n.some((x) => x.startsWith('vfx_shoot_tracer'))).toBe(false);
    const arrow = vfx.group.getObjectByName('vfx_arrow') as THREE.Mesh;
    vfx.update(1 / 60);
    const first = arrow.position.z;
    vfx.update(1 / 60);
    expect(arrow.position.z).toBeGreaterThan(first);
  });

  it('ビームは幅 0.2 m の帯と加算の芯で、弾の筋は出さない', () => {
    const vfx = make();
    shoot(vfx, 'laser', true);
    const n = names(vfx);
    expect(n).toContain('vfx_shot_line_beam');
    expect(n).toContain('vfx_shot_line_beam_core');
    expect(n).toContain('vfx_muzzle_ring');
    expect(n.some((x) => x.startsWith('vfx_shoot_tracer'))).toBe(false);
    const beam = vfx.group.getObjectByName('vfx_shot_line_beam') as THREE.Mesh;
    expect(beam.scale.x).toBeCloseTo(0.2, 5);
  });

  it('ライフルは残る細線と飛ぶ筋、ガトリングは短い筋、ショットガンは太い短い筋でメッシュ名が異なる', () => {
    const rifle = make();
    shoot(rifle, 'rifle');
    expect(names(rifle)).toContain('vfx_shot_line_precise');
    expect(names(rifle)).toContain('vfx_shoot_tracer_precise');
    const gatling = make();
    shoot(gatling, 'gatling');
    expect(names(gatling)).toContain('vfx_shoot_tracer_rapid');
    const shotgun = make();
    shoot(shotgun, 'shotgun');
    expect(names(shotgun)).toContain('vfx_shoot_tracer_pellet');
    const pellet = shotgun.group.getObjectByName('vfx_shoot_tracer_pellet') as THREE.Mesh;
    shotgun.update(1 / 60);
    expect(pellet.scale.x).toBeCloseTo(0.08, 5);
  });

  it('設置物・召喚体の射線(styleId なし)は弾の筋になる', () => {
    const vfx = make();
    vfx.trigger({ kind: 'tracer', from, to, charged: false, chargeRatio: 0 });
    expect(names(vfx)).toContain('vfx_shoot_tracer_bullet');
  });
});

describe('VfxPlayer の武器別の言語(近接)', () => {
  const make = () => new VfxPlayer(defaultConfig, 'medium', new THREE.CapsuleGeometry(0.4, 0.9));
  const swing = (
    vfx: VfxPlayer,
    styleId: string,
    attack: 'light' | 'heavy' = 'light',
    shape: 'sphere' | 'fan' | 'ring' | 'line' = 'sphere',
  ) =>
    vfx.trigger({
      kind: 'attackSwing',
      attack,
      position: { x: 0, y: 0, z: 0 },
      yaw: 0,
      action: shape === 'sphere' ? 'combo' : 'area',
      styleId,
      shape,
    });
  const visibleNames = (vfx: VfxPlayer) => {
    const out: string[] = [];
    vfx.group.traverse((o) => {
      if (o.visible && o.name.startsWith('vfx_')) out.push(o.name);
    });
    return out;
  };

  it('槍は柄 + 穂先の突きが前へ押し出され、剣術の帯は出ない', () => {
    const vfx = make();
    swing(vfx, 'spear');
    const spear = vfx.group.getObjectByName('vfx_spear_thrust_2') as THREE.Mesh | undefined;
    expect(spear).toBeDefined();
    if (!spear) return;
    const before = spear.position.z;
    vfx.update(1 / 60);
    vfx.update(1 / 60);
    expect(spear.position.z).toBeGreaterThan(before);
    expect(vfx.group.getObjectByName('vfx_light_slash_1.4')).toBeUndefined();
  });

  it('銃火器・弓投擲の発射(attackSwing)では剣術の帯を出さない', () => {
    const vfx = make();
    swing(vfx, 'laser');
    swing(vfx, 'bow');
    const visible: string[] = [];
    vfx.group.traverse((o) => {
      if (o.visible && o.name.includes('slash')) visible.push(o.name);
    });
    expect(visible).toEqual([]);
  });

  it('槍の突きは右手側(+x 側ではなく画面右 = -x)から出て、少し上を向く', () => {
    const vfx = make();
    swing(vfx, 'spear');
    const spear = vfx.group.getObjectByName('vfx_spear_thrust_2') as THREE.Mesh;
    // yaw 0(前方 +z)のとき右手は -x 側
    expect(spear.position.x).toBeLessThan(-0.2);
    const tip = new THREE.Vector3(0, 1, 0).applyQuaternion(spear.quaternion);
    expect(tip.z).toBeGreaterThan(0.9);
    expect(tip.y).toBeGreaterThan(0.15);
  });

  it('大槌は板の振り下ろし、拳は突きの線、棍は白灰の薄い帯、薙刀は淡シアンの広い帯', () => {
    const hammer = make();
    swing(hammer, 'warhammer', 'heavy');
    expect(hammer.group.getObjectByName('vfx_smash_slab')).toBeDefined();
    const fist = make();
    swing(fist, 'boxer');
    expect(fist.group.getObjectByName('vfx_jab_line')).toBeDefined();
    const staff = make();
    swing(staff, 'staff');
    expect(staff.group.getObjectByName('vfx_sweep_grey_1.8_150')).toBeDefined();
    const naginata = make();
    swing(naginata, 'naginata');
    expect(naginata.group.getObjectByName('vfx_sweep_cyan_2_180')).toBeDefined();
  });

  it('1 行動 1 形: 扇・リング・直線の判定を持つ行動では振りを出さず、attackVolume が武器型で形を描く', () => {
    const vfx = make();
    swing(vfx, 'staff', 'light', 'fan');
    expect(visibleNames(vfx)).toEqual([]);
    vfx.trigger({
      kind: 'attackVolume',
      attack: 'light',
      volume: { type: 'fan', origin: { x: 0, y: 0.85, z: 0 }, yaw: 0, radius: 1.6, angleDeg: 150 },
      styleId: 'staff',
    });
    expect(visibleNames(vfx)).toEqual(['vfx_sweep_grey_1.6_150']);
    const ring = make();
    ring.trigger({
      kind: 'attackVolume',
      attack: 'light',
      volume: { type: 'ring', origin: { x: 0, y: 0.85, z: 0 }, radius: 1.5, width: 1.5 },
      styleId: 'spin_slash',
    });
    expect(visibleNames(ring)).toEqual(['vfx_sweep_white_1.5_360']);
    const line = make();
    line.trigger({
      kind: 'attackVolume',
      attack: 'heavy',
      volume: { type: 'line', origin: { x: 0, y: 0.85, z: 0 }, yaw: 0, length: 4, width: 0.8 },
      styleId: 'skewer',
    });
    expect(visibleNames(line)).toEqual(['vfx_spear_thrust_4']);
    const magic = make();
    magic.trigger({
      kind: 'attackVolume',
      attack: 'medium',
      volume: { type: 'ring', origin: { x: 0, y: 0.85, z: 0 }, radius: 2, width: 1 },
      styleId: 'sonic',
    });
    expect(visibleNames(magic)).toEqual(['vfx_ring_orange']);
  });
});
