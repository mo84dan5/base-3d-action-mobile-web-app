import { degToRad } from '../config/gameConfig';
import type { Vec3 } from '../math/vec3';

// 検証用ステージの配置(F05「検証用ステージ」)。infrastructure がこの記述からメッシュとコリジョンを生成する。
// 座標系: y が上。基準面(平地)は y = 0。

export interface StageBox {
  readonly kind: 'box';
  readonly name: string;
  readonly center: Vec3;
  readonly size: Vec3;
  /** y 軸回りの回転(ラジアン) */
  readonly yaw?: number;
  /** x 軸回りの回転(ラジアン。斜面用) */
  readonly pitch?: number;
  readonly climbable: boolean;
  /** 描画しない(透明な外周壁など) */
  readonly invisible?: boolean;
  readonly color?: string;
}

export interface StageCylinder {
  readonly kind: 'cylinder';
  readonly name: string;
  readonly center: Vec3;
  readonly radius: number;
  readonly height: number;
  readonly climbable: boolean;
  readonly color?: string;
}

/** 斜度 slopeDeg の坂。底辺の中心 base から方向 yaw へ登る。頂上に平坦部 topLength を持てる。 */
export interface StageRamp {
  readonly kind: 'ramp';
  readonly name: string;
  readonly base: Vec3;
  readonly yaw: number;
  readonly slopeDeg: number;
  readonly height: number;
  readonly width: number;
  readonly climbable: boolean;
  readonly color?: string;
}

/** 円錐(氷柱など)。底面の中心が center.y、頂点が center.y + height */
export interface StageCone {
  readonly kind: 'cone';
  readonly name: string;
  readonly center: Vec3;
  readonly radius: number;
  readonly height: number;
  readonly climbable: boolean;
  readonly color?: string;
}

export type StagePrimitive = StageBox | StageCylinder | StageRamp | StageCone;

export interface EnemySpawn {
  readonly kind: 'dummy' | 'patrol';
  readonly position: Vec3;
}

export interface StageLayout {
  readonly groundSize: number;
  readonly playerStart: Vec3;
  readonly playerStartYaw: number;
  readonly signboard: { readonly position: Vec3; readonly label: string };
  readonly primitives: readonly StagePrimitive[];
  readonly enemies: readonly EnemySpawn[];
}

const COLOR_GRASS = '#6f8a5f';
const COLOR_DIRT = '#8a7a66';
/** 登攀可の岩肌(明るい砂色、彩度 30% 以下)。登攀不可は氷柱の淡い水色だけ */
const COLOR_CLIMBABLE = '#b3a58c';
const COLOR_ICE = '#cfe6f2';

export const stageLayout: StageLayout = {
  groundSize: 60,
  playerStart: { x: 0, y: 0, z: 0 },
  playerStartYaw: 0,
  signboard: { position: { x: 2.5, y: 0, z: 2.5 }, label: '看板' },
  primitives: [
    // 2. 緩い丘: 斜度 20 度、高さ 4 m、幅 6 m。z = 16 から −z 方向へ登り、頂上は直径 6 m の平坦(円柱)
    {
      kind: 'ramp',
      name: 'hill_slope',
      base: { x: -10, y: 0, z: 16 },
      yaw: Math.PI,
      slopeDeg: 20,
      height: 4,
      width: 6,
      climbable: true,
      color: COLOR_GRASS,
    },
    {
      kind: 'cylinder',
      name: 'hill_top',
      center: { x: -10, y: 2, z: 16 - 4 / Math.tan(degToRad(20)) - 3 },
      radius: 3,
      height: 4,
      climbable: true,
      color: COLOR_GRASS,
    },
    // 3. 急な坂: 斜度 45 度、高さ 3 m(滑り面)。z = −12 から +z 方向へ登る。背面は高さ 3 m の登攀不可の壁
    {
      kind: 'ramp',
      name: 'steep_slope',
      base: { x: 12, y: 0, z: -12 },
      yaw: 0,
      slopeDeg: 45,
      height: 3,
      width: 6,
      climbable: true,
      color: COLOR_DIRT,
    },
    // 4. 崖(登攀可): 高さ 6 m、幅 8 m の垂直面(z = −20、−z 側)。上は 10 m × 10 m の台地。側面も登攀可(#99986)
    {
      kind: 'box',
      name: 'cliff_face',
      center: { x: 0, y: 3, z: -25 },
      size: { x: 8, y: 6, z: 10 },
      climbable: true,
      color: COLOR_CLIMBABLE,
    },
    {
      kind: 'box',
      name: 'cliff_side_left',
      center: { x: -5, y: 3, z: -25 },
      size: { x: 2, y: 6, z: 10 },
      climbable: true,
      color: COLOR_CLIMBABLE,
    },
    {
      kind: 'box',
      name: 'cliff_side_right',
      center: { x: 5, y: 3, z: -25 },
      size: { x: 2, y: 6, z: 10 },
      climbable: true,
      color: COLOR_CLIMBABLE,
    },
    // 5. 高い崖: 高さ 20 m(x = 16 の面を登る)。高さ 10 m に幅 2 m のテラス(下段 x 16〜18 の上面)。
    //    裏側(東)に斜度 20 度のスロープ: A(南端を +x へ)→ 角の踊り場(高さ 10 m)→ B(東端を −z へ)→ 橋 で頂上へ
    {
      kind: 'box',
      name: 'tall_cliff_lower',
      center: { x: 20, y: 5, z: 0 },
      size: { x: 8, y: 10, z: 8 },
      climbable: true,
      color: COLOR_CLIMBABLE,
    },
    {
      kind: 'box',
      name: 'tall_cliff_upper',
      center: { x: 21, y: 15, z: 0 },
      size: { x: 6, y: 10, z: 8 },
      climbable: true,
      color: COLOR_CLIMBABLE,
    },
    {
      kind: 'ramp',
      name: 'tall_cliff_ramp_a',
      base: { x: -2, y: 0, z: 27.5 },
      yaw: Math.PI / 2,
      slopeDeg: 20,
      height: 10,
      width: 4,
      climbable: true,
      color: COLOR_DIRT,
    },
    {
      kind: 'box',
      name: 'tall_cliff_ramp_support',
      center: { x: 27.5, y: 5, z: 13.875 },
      size: { x: 4, y: 10, z: 31.25 },
      climbable: true,
      color: COLOR_CLIMBABLE,
    },
    {
      kind: 'ramp',
      name: 'tall_cliff_ramp_b',
      base: { x: 27.5, y: 10, z: 25.5 },
      yaw: Math.PI,
      slopeDeg: 20,
      height: 10,
      width: 4,
      climbable: true,
      color: COLOR_DIRT,
    },
    {
      kind: 'box',
      name: 'tall_cliff_bridge',
      center: { x: 24.75, y: 19.75, z: -2.5 },
      size: { x: 1.5, y: 0.5, z: 3 },
      climbable: true,
      color: COLOR_CLIMBABLE,
    },
    // 6. 検証用の壁: 高さ 4 m(#99986 で登攀可に変更)
    {
      kind: 'box',
      name: 'test_wall',
      center: { x: -24, y: 2, z: 14 },
      size: { x: 6, y: 4, z: 1 },
      climbable: true,
      color: COLOR_DIRT,
    },
    // 7. 段差: 0.3 / 0.5 / 1.0 m
    {
      kind: 'box',
      name: 'step_0_3',
      center: { x: -12, y: 0.15, z: -6 },
      size: { x: 3, y: 0.3, z: 3 },
      climbable: true,
      color: COLOR_CLIMBABLE,
    },
    {
      kind: 'box',
      name: 'step_0_5',
      center: { x: -12, y: 0.25, z: -9 },
      size: { x: 3, y: 0.5, z: 3 },
      climbable: true,
      color: COLOR_CLIMBABLE,
    },
    {
      kind: 'box',
      name: 'step_1_0',
      center: { x: -12, y: 0.5, z: -12 },
      size: { x: 3, y: 1.0, z: 3 },
      climbable: true,
      color: COLOR_CLIMBABLE,
    },
    // 8. オーバーハング: 下部は登攀可の壁(z = −2 の面)、上部が +z 側へ 1.5 m 張り出す(張り出し部の下面は天井)
    {
      kind: 'box',
      name: 'overhang_lower',
      center: { x: -22, y: 2.5, z: -4 },
      size: { x: 6, y: 5, z: 4 },
      climbable: true,
      color: COLOR_CLIMBABLE,
    },
    {
      kind: 'box',
      name: 'overhang_upper',
      center: { x: -22, y: 6, z: -2.5 },
      size: { x: 6, y: 2, z: 7 },
      climbable: true,
      color: COLOR_CLIMBABLE,
    },
    // 9. 柱: 直径 1 m、高さ 3 m × 3 本。登攀不可
    {
      kind: 'cylinder',
      name: 'pillar_1',
      center: { x: 8, y: 1.5, z: 10 },
      radius: 0.5,
      height: 3,
      climbable: true,
      color: COLOR_CLIMBABLE,
    },
    {
      kind: 'cylinder',
      name: 'pillar_2',
      center: { x: 11, y: 1.5, z: 12 },
      radius: 0.5,
      height: 3,
      climbable: true,
      color: COLOR_CLIMBABLE,
    },
    {
      kind: 'cylinder',
      name: 'pillar_3',
      center: { x: 9, y: 1.5, z: 14 },
      radius: 0.5,
      height: 3,
      climbable: true,
      color: COLOR_CLIMBABLE,
    },
    // 12. 氷柱: 底面半径 1.5 m・高さ 12 m の円錐。ステージで唯一の登攀不可オブジェクト(#99986)
    {
      kind: 'cone',
      name: 'icicle',
      center: { x: 7, y: 0, z: 3 },
      radius: 1.5,
      height: 12,
      climbable: false,
      color: COLOR_ICE,
    },
    // 10. 外周の壁: 高さ 30 m、透明、登攀不可(内側の面が ±30 m。見えない境界のため登攀不可のまま)
    {
      kind: 'box',
      name: 'boundary_north',
      center: { x: 0, y: 15, z: -30.5 },
      size: { x: 62, y: 30, z: 1 },
      climbable: false,
      invisible: true,
    },
    {
      kind: 'box',
      name: 'boundary_south',
      center: { x: 0, y: 15, z: 30.5 },
      size: { x: 62, y: 30, z: 1 },
      climbable: false,
      invisible: true,
    },
    {
      kind: 'box',
      name: 'boundary_east',
      center: { x: 30.5, y: 15, z: 0 },
      size: { x: 1, y: 30, z: 62 },
      climbable: false,
      invisible: true,
    },
    {
      kind: 'box',
      name: 'boundary_west',
      center: { x: -30.5, y: 15, z: 0 },
      size: { x: 1, y: 30, z: 62 },
      climbable: false,
      invisible: true,
    },
  ],
  enemies: [
    { kind: 'dummy', position: { x: -4, y: 0, z: 5 } },
    { kind: 'patrol', position: { x: 6, y: 0, z: -6 } },
    { kind: 'patrol', position: { x: -2, y: 0, z: 20 } },
  ],
};
