import type { CameraConfig, StickConfig } from '../config/gameConfig';
import type { Rect, Vec2 } from '../math/vec2';

// 画面向きとレイアウト(F09)。幅と高さを引数に取る純粋関数で、DOM に依存しない。

export type Orientation = 'portrait' | 'landscape';

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/** 横画面: 幅 > 高さ。縦画面: 幅 ≤ 高さ(正方形は縦画面)。 */
export function detectOrientation(width: number, height: number): Orientation {
  return width > height ? 'landscape' : 'portrait';
}

/** 幅と高さの大小関係が変わったときだけ true(アドレスバーの出入り等は false)。 */
export function isOrientationChange(prev: ViewportSize, next: ViewportSize): boolean {
  return detectOrientation(prev.width, prev.height) !== detectOrientation(next.width, next.height);
}

export interface InputRegions {
  /** スティック領域(F01) */
  readonly stick: Rect;
  /** カメラ領域(F02) */
  readonly camera: Rect;
  /** ボタン群の矩形(参考値。実際のボタン当たり判定は DOM が行う) */
  readonly buttons: Rect;
}

/**
 * 入力領域(F09)。境界は表示領域の中心線で判定し、セーフエリアは含めて計算する。
 * 横画面: スティック = 左半分、カメラ = 右半分
 * 縦画面: カメラ = 上半分の全幅、スティック = 下半分の左半分、ボタン群 = 下半分の右半分
 */
export function computeInputRegions(
  width: number,
  height: number,
  orientation: Orientation,
): InputRegions {
  const halfW = width / 2;
  const halfH = height / 2;
  if (orientation === 'landscape') {
    return {
      stick: { x: 0, y: 0, width: halfW, height },
      camera: { x: halfW, y: 0, width: halfW, height },
      buttons: { x: halfW, y: halfH, width: halfW, height: halfH },
    };
  }
  return {
    stick: { x: 0, y: halfH, width: halfW, height: halfH },
    camera: { x: 0, y: 0, width, height: halfH },
    buttons: { x: halfW, y: halfH, width: halfW, height: halfH },
  };
}

/** 設定「スティック: 固定」の中心位置(横: x 25%・y 70%、縦: x 25%・y 80%)。 */
export function fixedStickCenter(
  width: number,
  height: number,
  orientation: Orientation,
  config: StickConfig,
): Vec2 {
  const ratio = config.fixedPosition[orientation];
  return { x: width * ratio.x, y: height * ratio.y };
}

export interface ViewOffset {
  readonly fullWidth: number;
  readonly fullHeight: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * 注視点の投影位置を実現する `camera.setViewOffset` の引数(F09)。
 * setViewOffset はフルサイズ画像のうち (x, y) から (width, height) の部分領域を描画する。
 * y > 0 は部分領域をフル画像の下側へずらすため、表示される領域の中心はフル画像の中心(注視点)より下になり、
 * 注視点は表示領域の上寄りに現れる。上から targetScreenHeight の位置に置くには
 * y = height × (0.5 − targetScreenHeight)(縦画面 35% なら +0.15 × height)。
 */
export function viewOffsetFor(
  width: number,
  height: number,
  orientation: Orientation,
  config: CameraConfig,
): ViewOffset {
  const target = config.targetScreenHeight[orientation];
  return {
    fullWidth: width,
    fullHeight: height,
    x: 0,
    y: height * (0.5 - target),
    width,
    height,
  };
}

/** 垂直 FOV(度)。横画面 50 度 / 縦画面 70 度。 */
export function fovFor(orientation: Orientation, config: CameraConfig): number {
  return config.fovDeg[orientation];
}
