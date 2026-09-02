import { defaultConfig } from '../config/gameConfig';
import { vec3 } from '../math/vec3';
import { AnalyticTerrain, type AnalyticShape } from '../terrain/analyticTerrain';
import { createPlayer } from './playerFactory';
import type { PlayerEvent } from './playerEvents';
import type { PlayerState } from './playerState';
import { NO_INPUT, stepPlayer, type PlayerStepInput } from './playerStep';

// プレイヤー状態機械のテスト用ハーネス(本番コードからは参照しない)。

export const DT = 1 / 60;
export const config = defaultConfig;

export function forward(magnitude = 1): PlayerStepInput {
  return { ...NO_INPUT, stick: { x: 0, y: 1, magnitude } };
}

export function stickInput(x: number, y: number, magnitude = 1): PlayerStepInput {
  return { ...NO_INPUT, stick: { x, y, magnitude } };
}

export class Sim {
  player: PlayerState;
  events: PlayerEvent[] = [];
  readonly terrain: AnalyticTerrain;

  constructor(shapes: readonly AnalyticShape[] = [], start = vec3(0, 0, 0), yaw = 0) {
    this.terrain = AnalyticTerrain.flatGround(shapes);
    this.player = createPlayer(start, yaw, config);
  }

  step(input: PlayerStepInput = NO_INPUT, dt = DT): PlayerState {
    const r = stepPlayer(this.player, input, this.terrain, dt, config);
    this.player = r.player;
    this.events.push(...r.events);
    return this.player;
  }

  /** seconds 秒ぶん(丸めたステップ数)進める。 */
  run(seconds: number, input: PlayerStepInput = NO_INPUT): PlayerState {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) this.step(input);
    return this.player;
  }

  /** 条件を満たすまで進める(最大 maxSeconds)。 */
  until(
    pred: (p: PlayerState) => boolean,
    input: PlayerStepInput = NO_INPUT,
    maxSeconds = 10,
  ): PlayerState {
    const steps = Math.round(maxSeconds / DT);
    for (let i = 0; i < steps; i++) {
      if (pred(this.player)) return this.player;
      this.step(input);
    }
    return this.player;
  }

  has(type: PlayerEvent['type']): boolean {
    return this.events.some((e) => e.type === type);
  }

  count(type: PlayerEvent['type']): number {
    return this.events.filter((e) => e.type === type).length;
  }

  clearEvents(): void {
    this.events = [];
  }
}

/** 幅 w・奥行き d・高さ h の箱(足元 z 方向の手前面が z = zFront)。 */
export function wallBox(
  zFront: number,
  height: number,
  opts: { width?: number; depth?: number; unclimbable?: boolean; x?: number; yBase?: number } = {},
): AnalyticShape {
  const w = opts.width ?? 10;
  const d = opts.depth ?? 6;
  const x = opts.x ?? 0;
  const yBase = opts.yBase ?? 0;
  return {
    kind: 'box',
    min: vec3(x - w / 2, yBase, zFront),
    max: vec3(x + w / 2, yBase + height, zFront + d),
    unclimbable: opts.unclimbable ?? false,
  };
}
