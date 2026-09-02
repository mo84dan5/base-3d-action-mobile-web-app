import { el, onPress } from './dom';

// S01 タイトル画面。読み込み進捗・非対応表示・失敗表示・バージョン表記。
export class TitleScreen {
  readonly el: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly progress: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly progressText: HTMLElement;
  private readonly message: HTMLElement;
  private readonly reloadButton: HTMLButtonElement;
  private loaded = false;
  private unsupported = false;

  constructor(
    version: string,
    private readonly onStart: () => void,
  ) {
    this.el = el('section', 'screen title-screen');
    this.el.dataset.screen = 'title';
    const column = el('div', 'title-column');
    column.append(
      el('h1', 'title-heading', 'base-3d-action-mobile-web-app'),
      el('p', 'title-sub', 'スマートフォン向け 3D アクション操作基盤'),
    );
    this.startButton = el('button', 'btn primary', 'はじめる');
    this.startButton.disabled = true;
    this.startButton.dataset.testid = 'start';
    onPress(this.startButton, () => {
      if (this.startButton.disabled) return;
      this.onStart();
    });
    this.progress = el('div', 'progress');
    const track = el('div', 'progress-track');
    this.progressFill = el('div', 'progress-fill');
    track.append(this.progressFill);
    this.progressText = el('span', '', '0%');
    this.progress.append(track, this.progressText);
    this.message = el('div', 'title-message');
    this.message.hidden = true;
    this.reloadButton = el('button', 'btn', '再読み込み');
    this.reloadButton.hidden = true;
    onPress(this.reloadButton, () => location.reload());
    column.append(this.startButton, this.progress, this.message, this.reloadButton);
    this.el.append(column, el('div', 'version', `v${version}`));
  }

  setProgress(loaded: number, total: number): void {
    const ratio = total > 0 ? Math.min(1, loaded / total) : 1;
    this.progressFill.style.width = `${Math.round(ratio * 100)}%`;
    this.progressText.textContent = `${Math.round(ratio * 100)}%`;
  }

  setLoaded(): void {
    this.loaded = true;
    this.progress.hidden = true;
    if (!this.unsupported) this.startButton.disabled = false;
  }

  setUnsupported(): void {
    this.unsupported = true;
    this.progress.hidden = true;
    this.message.textContent = 'このブラウザでは動作しません';
    this.message.hidden = false;
    this.startButton.disabled = true;
  }

  setFailed(): void {
    this.progress.hidden = true;
    this.message.textContent = '読み込みに失敗しました。再読み込みしてください';
    this.message.hidden = false;
    this.reloadButton.hidden = false;
    this.startButton.disabled = true;
  }

  /** S03・S04 から戻ったとき: 読み込み済みなので即時有効。 */
  show(): void {
    this.el.hidden = false;
    if (this.loaded && !this.unsupported) {
      this.progress.hidden = true;
      this.startButton.disabled = false;
    }
  }

  hide(): void {
    this.el.hidden = true;
  }
}
