import { SETTINGS_STORAGE_KEY } from '../../domain/settings/settings';
import type { SettingsStore } from '../../application/ports';

// localStorage への設定の保存(F06)。使えない環境(プライベートモード・容量超過)では例外を握りつぶす。
export class LocalStorageSettingsStore implements SettingsStore {
  constructor(private readonly key: string = SETTINGS_STORAGE_KEY) {}

  load(): string | null {
    try {
      return window.localStorage.getItem(this.key);
    } catch {
      return null;
    }
  }

  save(json: string): void {
    try {
      window.localStorage.setItem(this.key, json);
    } catch {
      // メモリ上の設定のみで動作する
    }
  }
}
