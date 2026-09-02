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

export type StagePrimitive = StageBox | StageCylinder | StageRamp;

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
const COLOR_ROCK = '#7c7f84';
const COLOR_DIRT = '#8a7a66';

export const stageLayout: StageLayout = {
  groundSize: 60,
  playerStart: { x: 0, y: 0, z: 0 },
  playerStartYaw: 0,
  signboard: { position: { x: 2.5, y: 0, z: 2.5 }, label: '看板' },
  primitives: [
    // 2. 緩い丘: 斜度 20 度、高さ 4 m、頂上は直径 6 m の平坦
    {
      kind: 'ramp',
      name: 'hill_slope',
      base: { x: -6, y: 0, z: -18 },
      yaw: 0,
      slopeDeg: 20,
      height: 4,
      width: 10,
      climbable: false,
      color: COLOR_GRASS,
    },
    {
      kind: 'cylinder',
      name: 'hill_top',
      center: { x: -6, y: 2, z: -18 - 4 / Math.tan(degToRad(20)) - 3 },
      radius: 3,
      height: 4,
      climbable: false,
      color: COLOR_GRASS,
    },
    // 3. 急な坂: 斜度 45 度、高さ 3 m(滑り面)
    {
      kind: 'ramp',
      name: 'steep_slope',
      base: { x: 12, y: 0, z: -12 },
      yaw: 0,
      slopeDeg: 45,
      height: 3,
      width: 6,
      climbable: false,
      color: COLOR_DIRT,
    },
    {
      kind: 'box',
      name: 'steep_slope_back',
      center: { x: 12, y: 1.5, z: -12 - 3 - 1 },
      size: { x: 6, y: 3, z: 2 },
      climbable: false,
      color: COLOR_DIRT,
    },
    // 4. 崖(登攀可): 高さ 6 m、幅 8 m の垂直面。上は 10 m × 10 m の台地。崖面以外は登攀不可
    {
      kind: 'box',
      name: 'cliff_face',
      center: { x: 0, y: 3, z: -30 + 5 },
      size: { x: 8, y: 6, z: 10 },
      climbable: true,
      color: COLOR_ROCK,
    },
    {
      kind: 'box',
      name: 'cliff_side_left',
      center: { x: -5, y: 3, z: -30 + 5 },
      size: { x: 2, y: 6, z: 10 },
      climbable: false,
      color: COLOR_ROCK,
    },
    {
      kind: 'box',
      name: 'cliff_side_right',
      center: { x: 5, y: 3, z: -30 + 5 },
      size: { x: 2, y: 6, z: 10 },
      climbable: false,
      color: COLOR_ROCK,
    },
    // 5. 高い崖: 高さ 20 m。高さ 10 m に幅 2 m のテラス。裏側に斜度 20 度のスロープ
    {
      kind: 'box',
      name: 'tall_cliff_lower',
      center: { x: 22, y: 5, z: 4 },
      size: { x: 8, y: 10, z: 8 },
      climbable: true,
      color: COLOR_ROCK,
    },
    {
      kind: 'box',
      name: 'tall_cliff_upper',
      center: { x: 22, y: 15, z: 5 },
      size: { x: 8, y: 10, z: 6 },
      climbable: true,
      color: COLOR_ROCK,
    },
    {
      kind: 'ramp',
      name: 'tall_cliff_ramp',
      base: { x: 22, y: 0, z: 8 + 20 / Math.tan(degToRad(20)) },
      yaw: Math.PI,
      slopeDeg: 20,
      height: 20,
      width: 6,
      climbable: false,
      color: COLOR_DIRT,
    },
    // 6. 登攀不可の壁: 高さ 4 m
    {
      kind: 'box',
      name: 'unclimbable_wall',
      center: { x: -14, y: 2, z: 8 },
      size: { x: 6, y: 4, z: 1 },
      climbable: false,
      color: COLOR_DIRT,
    },
    // 7. 段差: 0.3 / 0.5 / 1.0 m
    {
      kind: 'box',
      name: 'step_0_3',
      center: { x: -12, y: 0.15, z: -6 },
      size: { x: 3, y: 0.3, z: 3 },
      climbable: false,
      color: COLOR_ROCK,
    },
    {
      kind: 'box',
      name: 'step_0_5',
      center: { x: -12, y: 0.25, z: -9 },
      size: { x: 3, y: 0.5, z: 3 },
      climbable: false,
      color: COLOR_ROCK,
    },
    {
      kind: 'box',
      name: 'step_1_0',
      center: { x: -12, y: 0.5, z: -12 },
      size: { x: 3, y: 1.0, z: 3 },
      climbable: false,
      color: COLOR_ROCK,
    },
    // 8. オーバーハング: 下部は登攀可の壁、上部が手前に張り出す(張り出し部の下面は天井)
    {
      kind: 'box',
      name: 'overhang_lower',
      center: { x: -22, y: 2.5, z: -4 },
      size: { x: 6, y: 5, z: 4 },
      climbable: true,
      color: COLOR_ROCK,
    },
    {
      kind: 'box',
      name: 'overhang_upper',
      center: { x: -22, y: 6, z: -4 + 1.5 },
      size: { x: 6, y: 2, z: 7 },
      climbable: true,
      color: COLOR_ROCK,
    },
    // 9. 柱: 直径 1 m、高さ 3 m × 3 本。登攀不可
    {
      kind: 'cylinder',
      name: 'pillar_1',
      center: { x: 8, y: 1.5, z: 10 },
      radius: 0.5,
      height: 3,
      climbable: false,
      color: COLOR_ROCK,
    },
    {
      kind: 'cylinder',
      name: 'pillar_2',
      center: { x: 11, y: 1.5, z: 12 },
      radius: 0.5,
      height: 3,
      climbable: false,
      color: COLOR_ROCK,
    },
    {
      kind: 'cylinder',
      name: 'pillar_3',
      center: { x: 9, y: 1.5, z: 14 },
      radius: 0.5,
      height: 3,
      climbable: false,
      color: COLOR_ROCK,
    },
    // 10. 外周の壁: 高さ 30 m、透明、登攀不可(±30 m)
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
    { kind: 'patrol', position: { x: -8, y: 0, z: 14 } },
  ],
};
