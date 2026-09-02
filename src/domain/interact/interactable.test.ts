import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/gameConfig';
import { vec3 } from '../math/vec3';
import { createSignboard, findInteractTarget, showMessage, tickMessage } from './interactable';

const config = defaultConfig.action;

describe('インタラクト対象(F03)', () => {
  it('看板は名前「看板」、範囲 2.0 m', () => {
    const sign = createSignboard(vec3(2.5, 0, 2.5), config);
    expect(sign.name).toBe('看板');
    expect(sign.range).toBe(2.0);
  });
  it('看板から 1.9 m では対象になり、2.1 m では対象にならない', () => {
    const sign = createSignboard(vec3(0, 0, 0), config);
    expect(findInteractTarget(vec3(1.9, 0, 0), [sign])).toBe(sign);
    expect(findInteractTarget(vec3(2.1, 0, 0), [sign])).toBeNull();
  });
  it('複数が範囲内なら最も近い対象を選ぶ', () => {
    const near = createSignboard(vec3(1, 0, 0), config, 'near');
    const far = createSignboard(vec3(-1.5, 0, 0), config, 'far');
    expect(findInteractTarget(vec3(0, 0, 0), [far, near])).toBe(near);
  });
  it('高低差も含めた 3D 距離で判定する', () => {
    const sign = createSignboard(vec3(0, 0, 0), config);
    expect(findInteractTarget(vec3(1.5, 1.5, 0), [sign])).toBeNull();
  });
});

describe('インタラクトのメッセージ(F03 看板)', () => {
  it('表示は 2 秒間で、2 秒経過すると消える', () => {
    const shown = showMessage('看板を読んだ', config);
    expect(shown.remaining).toBe(2.0);
    const m = tickMessage(shown, 1.5);
    expect(m?.remaining).toBeCloseTo(0.5);
    expect(tickMessage(m, 0.5)).toBeNull();
    expect(tickMessage(null, 1)).toBeNull();
  });
});
