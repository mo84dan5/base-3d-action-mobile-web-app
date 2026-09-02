import {
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
  SENSITIVITY_STEP,
  type Quality,
  type Settings,
  type StickMode,
} from '../domain/settings/settings';
import { el, onPress } from './dom';

// S03 ポーズメニュー。設定は変更のたびに onChange で通知し、呼び出し側が保存・反映する。
export interface PauseMenuCallbacks {
  readonly onChange: (settings: Settings) => void;
  readonly onResume: () => void;
  readonly onTitle: () => void;
}

export class PauseMenu {
  readonly el: HTMLElement;
  private settings: Settings;
  private readonly sensitivity: HTMLInputElement;
  private readonly sensitivityValue: HTMLElement;
  private readonly segments = new Map<string, HTMLButtonElement[]>();

  constructor(
    initial: Settings,
    private readonly callbacks: PauseMenuCallbacks,
  ) {
    this.settings = initial;
    this.el = el('section', 'screen pause-screen');
    this.el.dataset.screen = 'pause';
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    const dialog = el('div', 'dialog');
    const head = el('div', 'dialog-head');
    const close = el('button', 'close-btn', 'X');
    close.dataset.testid = 'pause-close';
    close.setAttribute('aria-label', '閉じる');
    onPress(close, () => this.callbacks.onResume());
    head.append(el('span', '', 'ポーズ'), close);
    const body = el('div', 'dialog-body');

    const sensRow = el('div', 'setting-row');
    const sliderRow = el('div', 'slider-row');
    this.sensitivity = el('input');
    this.sensitivity.type = 'range';
    this.sensitivity.min = String(SENSITIVITY_MIN);
    this.sensitivity.max = String(SENSITIVITY_MAX);
    this.sensitivity.step = String(SENSITIVITY_STEP);
    this.sensitivity.value = String(initial.cameraSensitivity);
    this.sensitivity.dataset.testid = 'setting-sensitivity';
    this.sensitivity.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.sensitivity.addEventListener('input', () => {
      const v = Math.round(Number(this.sensitivity.value) * 10) / 10;
      this.sensitivityValue.textContent = v.toFixed(1);
      this.commit({ ...this.settings, cameraSensitivity: v });
    });
    this.sensitivityValue = el('span', '', initial.cameraSensitivity.toFixed(1));
    sliderRow.append(this.sensitivity, this.sensitivityValue);
    sensRow.append(el('span', '', 'カメラ感度'), sliderRow);

    body.append(
      sensRow,
      this.toggleRow('カメラ上下反転', 'invertCameraY', initial.invertCameraY),
      this.toggleRow('カメラ左右反転', 'invertCameraX', initial.invertCameraX),
      this.segmentRow<StickMode>(
        'スティック',
        'stickMode',
        [
          ['floating', 'フローティング'],
          ['fixed', '固定'],
        ],
        initial.stickMode,
      ),
      this.segmentRow<Quality>(
        '表示品質',
        'quality',
        [
          ['low', '低'],
          ['medium', '中'],
          ['high', '高'],
        ],
        initial.quality,
      ),
      this.toggleRow('FPS 表示', 'showFps', initial.showFps),
    );
    const foot = el('div', 'dialog-foot');
    const resume = el('button', 'btn primary', '再開');
    resume.dataset.testid = 'resume';
    onPress(resume, () => this.callbacks.onResume());
    const title = el('button', 'btn', 'タイトルへ戻る');
    title.dataset.testid = 'pause-title';
    onPress(title, () => this.callbacks.onTitle());
    foot.append(resume, title);
    dialog.append(head, body, foot);
    this.el.append(dialog);
  }

  private commit(next: Settings): void {
    this.settings = next;
    this.callbacks.onChange(next);
  }

  private toggleRow(
    label: string,
    key: 'invertCameraY' | 'invertCameraX' | 'showFps',
    value: boolean,
  ): HTMLElement {
    return this.segmentRow<boolean>(
      label,
      key,
      [
        [false, 'OFF'],
        [true, 'ON'],
      ],
      value,
    );
  }

  private segmentRow<T extends string | boolean>(
    label: string,
    key: keyof Settings,
    options: [T, string][],
    value: T,
  ): HTMLElement {
    const row = el('div', 'setting-row');
    const seg = el('div', 'segmented');
    seg.dataset.testid = `setting-${key}`;
    const buttons: HTMLButtonElement[] = [];
    for (const [v, text] of options) {
      const b = el('button', v === value ? 'on' : '', text);
      b.dataset.value = String(v);
      onPress(b, () => {
        for (const other of buttons) other.classList.toggle('on', other === b);
        this.commit({ ...this.settings, [key]: v });
      });
      buttons.push(b);
      seg.append(b);
    }
    this.segments.set(key, buttons);
    row.append(el('span', '', label), seg);
    return row;
  }

  current(): Settings {
    return this.settings;
  }

  show(): void {
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }
}
