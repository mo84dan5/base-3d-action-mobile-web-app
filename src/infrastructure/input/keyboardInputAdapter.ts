import type { ButtonInputSet, ButtonKind } from '../../domain/input/buttonPressTracker';
import type { InputCommand } from '../../domain/input/inputCommand';
import { keyboardStick, type KeyboardMoveKeys } from '../../domain/stick/virtualStick';

// PC 用の補助入力(S02 補助入力)。WASD / Ctrl / Shift / Space / E / Q / F / Esc をタッチ操作と等価に扱う。
// ボタン系は ui の HUD ボタンと同じ ButtonInputSet を通す(押下 / 長押し判定を共有)。

const KEY_TO_BUTTON: Readonly<Record<string, ButtonKind>> = {
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  Space: 'jump',
  KeyE: 'skill',
  KeyQ: 'burst',
  KeyF: 'interact',
  Escape: 'pause',
};

export class KeyboardInputAdapter {
  private readonly keys: { w: boolean; a: boolean; s: boolean; d: boolean } = {
    w: false,
    a: false,
    s: false,
    d: false,
  };
  private ctrl = false;
  private readonly queue: InputCommand[] = [];
  private readonly onKeyDown = (e: KeyboardEvent) => this.keyDown(e);
  private readonly onKeyUp = (e: KeyboardEvent) => this.keyUp(e);
  private readonly onBlur = () => this.cancelAll();

  constructor(
    private readonly target: Window,
    private readonly buttons: ButtonInputSet,
    private readonly now: () => number,
  ) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
  }

  drain(): InputCommand[] {
    return this.queue.splice(0, this.queue.length);
  }

  cancelAll(): void {
    this.keys.w = this.keys.a = this.keys.s = this.keys.d = false;
    this.ctrl = false;
    this.queue.push({ type: 'Move', x: 0, y: 0 });
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.repeat) return;
    if (this.updateMoveKey(e.code, true)) {
      e.preventDefault();
      return;
    }
    const kind = KEY_TO_BUTTON[e.code];
    if (!kind) return;
    e.preventDefault();
    this.buttons.press(kind, this.now());
  }

  private keyUp(e: KeyboardEvent): void {
    if (this.updateMoveKey(e.code, false)) return;
    const kind = KEY_TO_BUTTON[e.code];
    if (!kind) return;
    this.queue.push(...this.buttons.release(kind));
  }

  private updateMoveKey(code: string, down: boolean): boolean {
    const map: Record<string, keyof KeyboardMoveKeys> = {
      KeyW: 'w',
      KeyA: 'a',
      KeyS: 's',
      KeyD: 'd',
    };
    const key = map[code];
    if (code === 'ControlLeft' || code === 'ControlRight') {
      this.ctrl = down;
      this.emitMove();
      return true;
    }
    if (!key) return false;
    this.keys[key] = down;
    this.emitMove();
    return true;
  }

  private emitMove(): void {
    const s = keyboardStick(this.keys, this.ctrl);
    this.queue.push({ type: 'Move', x: s.x * s.magnitude, y: s.y * s.magnitude });
  }
}
