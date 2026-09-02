import { describe, expect, it } from 'vitest';
import {
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSION,
  defaultSettings,
  normalizeSensitivity,
  parseSettings,
  qualityPreset,
  serializeSettings,
} from './settings';

describe('parseSettings(F06 読み込み)', () => {
  it('キーが無い(null)場合は初期値', () => {
    expect(parseSettings(null)).toEqual(defaultSettings);
  });
  it('壊れた JSON は全体を初期値にする', () => {
    expect(parseSettings('{not json')).toEqual(defaultSettings);
  });
  it('JSON がオブジェクトでない(配列・数値)場合は初期値', () => {
    expect(parseSettings('[1,2]')).toEqual(defaultSettings);
    expect(parseSettings('42')).toEqual(defaultSettings);
  });
  it('version が 99(現在値より大きい)なら全体が初期値になる', () => {
    const raw = JSON.stringify({ version: 99, cameraSensitivity: 1.5, showFps: true });
    expect(parseSettings(raw)).toEqual(defaultSettings);
  });
  it('version が数値でない場合は全体が初期値になる', () => {
    const raw = JSON.stringify({ version: '1', cameraSensitivity: 1.5 });
    expect(parseSettings(raw)).toEqual(defaultSettings);
  });
  it('version が無い場合も全体が初期値になる', () => {
    expect(parseSettings(JSON.stringify({ cameraSensitivity: 1.5 }))).toEqual(defaultSettings);
  });
  it('version 0(旧バージョン)は移行処理を経て各項目を読み込む', () => {
    const raw = JSON.stringify({ version: 0, cameraSensitivity: 1.5, showFps: true });
    expect(parseSettings(raw)).toEqual({
      ...defaultSettings,
      cameraSensitivity: 1.5,
      showFps: true,
    });
  });
  it('正常なデータはそのまま復元される', () => {
    const settings = {
      cameraSensitivity: 1.7,
      invertCameraY: true,
      invertCameraX: true,
      stickMode: 'fixed' as const,
      quality: 'high' as const,
      showFps: true,
    };
    expect(parseSettings(serializeSettings(settings))).toEqual(settings);
  });
  it('範囲外の感度 5.0 は 2.0 にクランプされる', () => {
    const raw = JSON.stringify({ version: 1, cameraSensitivity: 5.0 });
    expect(parseSettings(raw).cameraSensitivity).toBe(2.0);
  });
  it('範囲外の感度 0.1 は 0.5 にクランプされる', () => {
    const raw = JSON.stringify({ version: 1, cameraSensitivity: 0.1 });
    expect(parseSettings(raw).cameraSensitivity).toBe(0.5);
  });
  it('感度 1.26 は 0.1 刻みに丸めて 1.3 になる', () => {
    const raw = JSON.stringify({ version: 1, cameraSensitivity: 1.26 });
    expect(parseSettings(raw).cameraSensitivity).toBeCloseTo(1.3);
  });
  it('感度に文字列が入っていてもその項目だけ初期値になり、他の項目は保持される', () => {
    const raw = JSON.stringify({ version: 1, cameraSensitivity: 'high', showFps: true });
    const settings = parseSettings(raw);
    expect(settings.cameraSensitivity).toBe(1.0);
    expect(settings.showFps).toBe(true);
  });
  it('感度が NaN / Infinity の場合はその項目だけ初期値', () => {
    expect(parseSettings('{"version":1,"cameraSensitivity":null}').cameraSensitivity).toBe(1.0);
  });
  it('boolean 項目に文字列が入っていればその項目だけ初期値', () => {
    const raw = JSON.stringify({ version: 1, invertCameraY: 'true', invertCameraX: true });
    const settings = parseSettings(raw);
    expect(settings.invertCameraY).toBe(false);
    expect(settings.invertCameraX).toBe(true);
  });
  it('選択肢にない stickMode / quality はその項目だけ初期値', () => {
    const raw = JSON.stringify({
      version: 1,
      stickMode: 'gamepad',
      quality: 'ultra',
      showFps: true,
    });
    const settings = parseSettings(raw);
    expect(settings.stickMode).toBe('floating');
    expect(settings.quality).toBe('medium');
    expect(settings.showFps).toBe(true);
  });
});

describe('serializeSettings(F06 保存)', () => {
  it('version 1 を含む JSON になる', () => {
    const parsed = JSON.parse(serializeSettings(defaultSettings)) as Record<string, unknown>;
    expect(parsed.version).toBe(SETTINGS_VERSION);
    expect(parsed.cameraSensitivity).toBe(1.0);
    expect(parsed.stickMode).toBe('floating');
  });
  it('保存キーは b3d.settings.v1', () => {
    expect(SETTINGS_STORAGE_KEY).toBe('b3d.settings.v1');
  });
});

describe('normalizeSensitivity', () => {
  it('0.5〜2.0 にクランプして 0.1 刻みに丸める', () => {
    expect(normalizeSensitivity(3)).toBe(2.0);
    expect(normalizeSensitivity(0)).toBe(0.5);
    expect(normalizeSensitivity(0.94)).toBeCloseTo(0.9);
    expect(normalizeSensitivity(0.95)).toBeCloseTo(1.0);
  });
});

describe('qualityPreset(F06 表示品質プリセット)', () => {
  it('低: 解像度 0.75、影なし、VFX 上限 120、粒 0.5 倍、残像なし、風の線 3 本', () => {
    expect(qualityPreset('low')).toEqual({
      pixelRatioScale: 0.75,
      shadowMapSize: 0,
      vfxMeshLimit: 120,
      particleMultiplier: 0.5,
      afterimageCount: 0,
      windLineCount: 3,
    });
  });
  it('中: 解像度 1.0、影 1024、VFX 上限 250、粒 1.0 倍、残像 2 枚、風の線 6 本', () => {
    expect(qualityPreset('medium')).toEqual({
      pixelRatioScale: 1.0,
      shadowMapSize: 1024,
      vfxMeshLimit: 250,
      particleMultiplier: 1,
      afterimageCount: 2,
      windLineCount: 6,
    });
  });
  it('高: 解像度は端末依存、影 2048、VFX 上限 400', () => {
    const preset = qualityPreset('high');
    expect(preset.pixelRatioScale).toBe('device');
    expect(preset.shadowMapSize).toBe(2048);
    expect(preset.vfxMeshLimit).toBe(400);
  });
});
