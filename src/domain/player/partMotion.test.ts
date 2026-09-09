import { describe, expect, it } from 'vitest';
import { ATTACK_STYLES, findAttackStyle } from '../attackStyle/attackStyleCatalog';
import { defaultConfig } from '../config/gameConfig';
import type { EquipmentSlot } from '../equipment/equipment';
import { DEFAULT_MOTION_SECONDS, motionTotalOf, partMotionOf } from './partMotion';
import { createPlayer } from './playerFactory';
import type { ActionRuntime, PlayerState } from './playerState';

const base = createPlayer({ x: 0, y: 0, z: 0 }, 0, defaultConfig);

function acting(
  styleId: string,
  source: 'press' | 'hold',
  elapsed: number,
  slot: EquipmentSlot = 'rightArm',
  extra: Partial<PlayerState> = {},
): PlayerState {
  const style = findAttackStyle(styleId);
  if (!style) throw new Error(`no style ${styleId}`);
  const spec = source === 'press' ? style.press : style.hold.action;
  const action: ActionRuntime = {
    spec,
    kind: 'light',
    source,
    styleId,
    then: null,
    chargeRatio: 0,
    radiusScale: 1,
    elapsed,
    phase: '',
    hits: 0,
    nextAt: 0,
    dir: { x: 0, y: 0, z: 1 },
    travelled: 0,
    targetId: null,
    fired: false,
    succeeded: false,
    damageScale: 1,
  };
  return { ...base, techniqueSlot: slot, action, ...extra };
}

describe('partMotionOf(F12 技のモーション)', () => {
  it('技の実行中でなければ null', () => {
    expect(partMotionOf(base)).toBeNull();
    expect(partMotionOf({ ...base, techniqueSlot: 'head', action: null })).toBeNull();
  });
  it('押下の格闘(コンボ 1 段目)は右腕で、経過 / 段の全体が progress になる', () => {
    const style = findAttackStyle('melee');
    if (style?.press.kind !== 'combo') throw new Error('unreachable');
    const total = style.press.stages[0]?.total ?? 0;
    const p = acting('melee', 'press', total / 2, 'rightArm', {
      attack: { stage: 1, elapsed: total / 2, attackId: 1, hitTargets: [], bufferedAttack: false },
    });
    expect(partMotionOf(p)).toEqual({ part: 'rightArm', progress: 0.5, hold: false });
  });
  it('頭に装備したスタイルの技は part = head になり、progress は 1 を超えない', () => {
    const m = partMotionOf(acting('laser', 'press', 99, 'head'));
    expect(m?.part).toBe('head');
    expect(m?.progress).toBe(1);
  });
  it('長押しのタメ(離すまで続く)は保持の区間(0.5)で止まり hold = true', () => {
    const style = findAttackStyle('gun');
    expect(style?.hold.action.kind).toBe('charge');
    expect(partMotionOf(acting('gun', 'hold', 0.05))).toEqual({
      part: 'rightArm',
      progress: 0.05 / DEFAULT_MOTION_SECONDS,
      hold: true,
    });
    expect(partMotionOf(acting('gun', 'hold', 3))?.progress).toBe(0.5);
  });
  it('多段ヒット(乱舞)は 1 ティックごとに progress が 0 に戻る', () => {
    const style = ATTACK_STYLES.find(
      (s) => s.hold.action.kind === 'multihit' && !s.hold.action.whileHeld,
    );
    const spec = style?.hold.action;
    if (!style || spec?.kind !== 'multihit') throw new Error('no multihit style');
    const at = (t: number) => partMotionOf(acting(style.id, 'hold', t))?.progress;
    expect(at(spec.interval * 1.5)).toBeCloseTo(0.5, 6);
    expect(at(spec.interval * 2)).toBeCloseTo(0, 6);
  });
  it('全体の長さを持たない行動は既定の 0.4 秒', () => {
    expect(motionTotalOf({ kind: 'none' }, 1)).toBe(DEFAULT_MOTION_SECONDS);
  });
});
