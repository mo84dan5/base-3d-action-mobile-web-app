import { describe, expect, it } from 'vitest';
import type { PlayerStateName } from '../player/playerState';
import {
  type ActionGateContext,
  attackEnabled,
  burstEnabled,
  computeButtonStates,
  interactEnabled,
  jumpButtonLabel,
  sprintButtonLabel,
  techniqueEnabled,
} from './actionGate';

const base: ActionGateContext = {
  playerState: 'idle',
  climbPhase: null,
  countdownActive: false,
  activeTechniqueSlot: null,
  movementSlots: [],
  staminaEmpty: false,
  staminaSlots: [],
  burstCooldownReady: true,
  energyFull: true,
  hasInteractTarget: true,
};
const inState = (playerState: PlayerStateName, extra: Partial<ActionGateContext> = {}) => ({
  ...base,
  playerState,
  ...extra,
});

describe('通常攻撃ボタン(F03)', () => {
  it('Idle/Walk/Run/Sprint と Jump/Fall で有効', () => {
    for (const s of ['idle', 'walk', 'run', 'sprint', 'jump', 'fall'] as const) {
      expect(attackEnabled(inState(s))).toBe(true);
    }
  });
  it('Dash/Slide/Climb/Glide/硬直中は無効', () => {
    for (const s of ['dash', 'slide', 'climb', 'glide', 'hit', 'attack', 'dead'] as const) {
      expect(attackEnabled(inState(s))).toBe(false);
    }
  });
  it('開始カウントダウン中は無効', () => {
    expect(attackEnabled(inState('idle', { countdownActive: true }))).toBe(false);
  });
});

describe('技ボタン(F03 / F12)', () => {
  it('攻撃ボタンと同じ条件で有効(接地移動中・空中)', () => {
    expect(techniqueEnabled(inState('run'), 'leftArm')).toBe(true);
    expect(techniqueEnabled(inState('jump'), 'head')).toBe(true);
  });
  it('別スロットの技の実行中は無効、同じスロットなら有効(連射・コンボの続き)', () => {
    expect(techniqueEnabled(inState('shoot', { activeTechniqueSlot: 'rightArm' }), 'head')).toBe(
      false,
    );
    expect(
      techniqueEnabled(inState('shoot', { activeTechniqueSlot: 'rightArm' }), 'rightArm'),
    ).toBe(true);
  });
  it('Dash 中・カウントダウン中は無効', () => {
    expect(techniqueEnabled(inState('dash'), 'leftArm')).toBe(false);
    expect(techniqueEnabled(inState('idle', { countdownActive: true }), 'head')).toBe(false);
  });
  it('スタミナ 0 ではスタミナ技のスロットだけ無効(F12)', () => {
    const ctx = { staminaEmpty: true, staminaSlots: ['rightArm'] as const };
    expect(techniqueEnabled(inState('idle', ctx), 'rightArm')).toBe(false);
    expect(techniqueEnabled(inState('idle', ctx), 'leftArm')).toBe(true);
    expect(techniqueEnabled(inState('idle', { ...ctx, staminaEmpty: false }), 'rightArm')).toBe(
      true,
    );
  });
  it('移動連動のスタイルを装備したスロットは Dash / Sprint / Glide 中も有効(F03 の例外。F11 N7)', () => {
    const ctx = { movementSlots: ['leftArm'] as const };
    expect(techniqueEnabled(inState('dash', ctx), 'leftArm')).toBe(true);
    expect(techniqueEnabled(inState('glide', ctx), 'leftArm')).toBe(true);
    expect(techniqueEnabled(inState('dash', ctx), 'rightArm')).toBe(false);
    expect(techniqueEnabled(inState('dash', { ...ctx, countdownActive: true }), 'leftArm')).toBe(
      false,
    );
    expect(
      techniqueEnabled(inState('dash', { ...ctx, activeTechniqueSlot: 'head' }), 'leftArm'),
    ).toBe(false);
  });
});

describe('バーストボタン(F03)', () => {
  it('エネルギー 100%・接地中・クールダウン終了で有効', () => {
    expect(burstEnabled(inState('walk'))).toBe(true);
  });
  it('エネルギー不足・クールダウン中・空中では無効', () => {
    expect(burstEnabled(inState('walk', { energyFull: false }))).toBe(false);
    expect(burstEnabled(inState('walk', { burstCooldownReady: false }))).toBe(false);
    expect(burstEnabled(inState('fall'))).toBe(false);
  });
});

describe('インタラクトボタン(F03)', () => {
  it('対象が範囲内で接地移動中なら有効', () => {
    expect(interactEnabled(inState('idle'))).toBe(true);
  });
  it('対象なし・攻撃中・空中・カウントダウン中は無効', () => {
    expect(interactEnabled(inState('idle', { hasInteractTarget: false }))).toBe(false);
    expect(interactEnabled(inState('attack'))).toBe(false);
    expect(interactEnabled(inState('jump'))).toBe(false);
    expect(interactEnabled(inState('idle', { countdownActive: true }))).toBe(false);
  });
});

describe('ラベル(F03 / S02)', () => {
  it('崖登り中はスプリントボタンのラベルが「離す」', () => {
    expect(sprintButtonLabel('climb')).toBe('離す');
    expect(sprintButtonLabel('jump')).toBe('スプリント');
  });
  it('ジャンプボタンは Climb で「崖ジャンプ」、Glide で「滑空解除」、Fall で「滑空」', () => {
    expect(jumpButtonLabel('climb')).toBe('崖ジャンプ');
    expect(jumpButtonLabel('glide')).toBe('滑空解除');
    expect(jumpButtonLabel('fall')).toBe('滑空');
    expect(jumpButtonLabel('idle')).toBe('ジャンプ');
  });
});

describe('computeButtonStates', () => {
  it('崖登り中はジャンプ・スプリントのみ有効でラベルが切り替わる', () => {
    const states = computeButtonStates(inState('climb', { climbPhase: 'climbing' }));
    expect(states.attack.enabled).toBe(false);
    expect(states.leftArm.enabled).toBe(false);
    expect(states.head.enabled).toBe(false);
    expect(states.burst.enabled).toBe(false);
    expect(states.jump).toEqual({ enabled: true, label: '崖ジャンプ' });
    expect(states.sprint).toEqual({ enabled: true, label: '離す' });
    expect(states.interact.enabled).toBe(false);
  });
});
