import type { Vec3 } from '../domain/math/vec3';
import type { EffectEvent } from './effects';

// application が定義し infrastructure が実装するポート(F07 レイヤ構成)。

/** 単調増加する時刻(秒)。 */
export interface Clock {
  now(): number;
}

/** 設定の永続化(F06)。失敗時は例外を投げずに握りつぶす実装とする。 */
export interface SettingsStore {
  load(): string | null;
  save(json: string): void;
}

export interface ScreenPoint {
  /** CSS px(表示領域の左上原点) */
  readonly x: number;
  readonly y: number;
  /** カメラの前方にあるか(後方なら表示しない) */
  readonly inFront: boolean;
}

/** 3D → 2D 投影(ダメージ数値・敵 HP バー用)。 */
export interface ScreenProjector {
  project(world: Vec3): ScreenPoint;
}

/** VFX・SE・振動の発火点(F10)。見た目は infrastructure が決める。 */
export interface EffectPort {
  trigger(event: EffectEvent): void;
}

/** 疑似乱数(テストで固定できるようにする)。 */
export type RandomSource = () => number;
