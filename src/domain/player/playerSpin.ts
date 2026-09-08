import type { PlayerState } from './playerState';

// 回転攻撃の表示用回転速度(F11)。判定がリングの多段ヒット / 範囲攻撃の間だけプレイヤーの表示を回す。
// ロジックの yaw(移動方向・ターゲット補正)には影響しない。

/** リング判定の多段ヒット中の回転数(回転/秒) */
export const MULTIHIT_SPIN_TURNS_PER_SECOND = 2;

/** 表示用の回転速度(rad/s)。回さないときは 0。 */
export function spinRateOf(p: PlayerState): number {
  const spec = p.action?.spec;
  if (!spec) return 0;
  if (spec.kind === 'multihit' && p.name === 'multihit' && spec.shape.type === 'ring') {
    return MULTIHIT_SPIN_TURNS_PER_SECOND * Math.PI * 2;
  }
  if (spec.kind === 'area' && p.name === 'area' && spec.shape.type === 'ring' && spec.total > 0) {
    return (Math.PI * 2) / spec.total;
  }
  return 0;
}
