import type { ActionConfig } from '../config/gameConfig';
import { distance, type Vec3 } from '../math/vec3';

// インタラクト対象(F03)。将来の宝箱・NPC などに拡張できるよう対象名・範囲・実行処理を抽象化する。
export interface Interactable {
  readonly id: string;
  readonly name: string;
  readonly position: Vec3;
  /** この距離(m)以内でインタラクトできる */
  readonly range: number;
}

/** 範囲内で最も近い対象。無ければ null。 */
export function findInteractTarget(
  playerPos: Vec3,
  targets: readonly Interactable[],
): Interactable | null {
  let best: Interactable | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const d = distance(playerPos, target.position);
    if (d > target.range || d >= bestDistance) continue;
    best = target;
    bestDistance = d;
  }
  return best;
}

/** 検証用の看板(range 2.0 m)。 */
export function createSignboard(
  position: Vec3,
  config: Pick<ActionConfig, 'signboardRange'>,
  id = 'signboard',
): Interactable {
  return { id, name: '看板', position, range: config.signboardRange };
}

/** インタラクト実行時に画面中央へ出すメッセージ(2 秒間)。 */
export interface InteractMessage {
  readonly text: string;
  readonly remaining: number;
}

export function showMessage(
  text: string,
  config: Pick<ActionConfig, 'interactMessageSeconds'>,
): InteractMessage {
  return { text, remaining: config.interactMessageSeconds };
}

export function tickMessage(message: InteractMessage | null, dt: number): InteractMessage | null {
  if (message === null) return null;
  const remaining = message.remaining - dt;
  return remaining > 0 ? { ...message, remaining } : null;
}
