import { clamp } from '../math/vec3';

// 設定と永続化(F06)。localStorage の読み書きは infrastructure が行い、本モジュールは検証・移行・直列化のみを担う。

export type StickMode = 'floating' | 'fixed';
export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  readonly cameraSensitivity: number;
  readonly invertCameraY: boolean;
  readonly invertCameraX: boolean;
  readonly stickMode: StickMode;
  readonly quality: Quality;
  readonly showFps: boolean;
}

export const SETTINGS_STORAGE_KEY = 'b3d.settings.v1';
export const SETTINGS_VERSION = 1;

export const SENSITIVITY_MIN = 0.5;
export const SENSITIVITY_MAX = 2.0;
export const SENSITIVITY_STEP = 0.1;

export const defaultSettings: Settings = {
  cameraSensitivity: 1.0,
  invertCameraY: false,
  invertCameraX: false,
  stickMode: 'floating',
  quality: 'medium',
  showFps: false,
};

const STICK_MODES: readonly StickMode[] = ['floating', 'fixed'];
const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

/** 感度を 0.5〜2.0 にクランプし 0.1 刻みに丸める。 */
export function normalizeSensitivity(value: number): number {
  const clamped = clamp(value, SENSITIVITY_MIN, SENSITIVITY_MAX);
  return Math.round(clamped * 10) / 10;
}

/**
 * 旧バージョンのデータを現在の形式へ移行する。
 * 現在は version 1 が最初の形式のため、そのまま返す。version を上げるときはここに移行処理を書く。
 */
export function migrateSettings(
  _fromVersion: number,
  data: Record<string, unknown>,
): Record<string, unknown> {
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function fieldsFrom(data: Record<string, unknown>): Settings {
  return {
    cameraSensitivity: normalizeSensitivity(
      readNumber(data.cameraSensitivity, defaultSettings.cameraSensitivity),
    ),
    invertCameraY: readBoolean(data.invertCameraY, defaultSettings.invertCameraY),
    invertCameraX: readBoolean(data.invertCameraX, defaultSettings.invertCameraX),
    stickMode: readEnum(data.stickMode, STICK_MODES, defaultSettings.stickMode),
    quality: readEnum(data.quality, QUALITIES, defaultSettings.quality),
    showFps: readBoolean(data.showFps, defaultSettings.showFps),
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 保存文字列から設定を復元する(F06 読み込み)。
 * 1. キーが無い / JSON 解析失敗 → 全体を初期値
 * 2. version が数値でない、または現在値より大きい → 全体を初期値
 * 3. version が小さい → 移行処理
 * 4. 型が違う項目はその項目のみ初期値。範囲外はクランプ、刻みに丸める
 */
export function parseSettings(raw: string | null): Settings {
  if (raw === null) return defaultSettings;
  const parsed = parseJson(raw);
  if (!isRecord(parsed)) return defaultSettings;
  const version = parsed.version;
  if (typeof version !== 'number' || !Number.isFinite(version)) return defaultSettings;
  if (version > SETTINGS_VERSION) return defaultSettings;
  const data = version < SETTINGS_VERSION ? migrateSettings(version, parsed) : parsed;
  return fieldsFrom(data);
}

export function serializeSettings(settings: Settings): string {
  return JSON.stringify({ version: SETTINGS_VERSION, ...settings });
}

export interface QualityPreset {
  /** 解像度スケール。'device' は min(devicePixelRatio, 2)(infrastructure が計算) */
  readonly pixelRatioScale: number | 'device';
  readonly shadowMapSize: 0 | 1024 | 2048;
  readonly vfxMeshLimit: 120 | 250 | 400;
  readonly particleMultiplier: 0.5 | 1;
  readonly afterimageCount: 0 | 2;
  readonly windLineCount: 3 | 6;
}

const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: {
    pixelRatioScale: 0.75,
    shadowMapSize: 0,
    vfxMeshLimit: 120,
    particleMultiplier: 0.5,
    afterimageCount: 0,
    windLineCount: 3,
  },
  medium: {
    pixelRatioScale: 1.0,
    shadowMapSize: 1024,
    vfxMeshLimit: 250,
    particleMultiplier: 1,
    afterimageCount: 2,
    windLineCount: 6,
  },
  high: {
    pixelRatioScale: 'device',
    shadowMapSize: 2048,
    vfxMeshLimit: 400,
    particleMultiplier: 1,
    afterimageCount: 2,
    windLineCount: 6,
  },
};

/** 表示品質プリセット(F06)。 */
export function qualityPreset(quality: Quality): QualityPreset {
  return QUALITY_PRESETS[quality];
}
