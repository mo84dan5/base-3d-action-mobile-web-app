import { pinchDeltaToZoom, wheelToZoom } from '../../domain/camera/cameraOrbit';
import type { GameConfig } from '../../domain/config/gameConfig';
import type { InputCommand } from '../../domain/input/inputCommand';
import { rectContains, type Vec2 } from '../../domain/math/vec2';
import type { InputRegions } from '../../domain/orientation/orientation';
import type { StickMode } from '../../domain/settings/settings';
import {
  canStartFixedStick,
  computeStickInput,
  knobPosition,
} from '../../domain/stick/virtualStick';

// Pointer Events をスティック / カメラ / ピンチの InputCommand に変換する(S02 入力の優先順位、F01、F02、F09)。
// HUD のボタンは ui 側で pointerdown を消費(stopPropagation)するため、ここには届かない。

type PointerRole = 'stick' | 'camera' | 'pinch' | 'dead';

interface TrackedPointer {
  role: PointerRole;
  x: number;
  y: number;
}

export interface StickVisual {
  readonly center: Vec2;
  readonly knob: Vec2;
}

export interface PointerInputOptions {
  readonly getRegions: () => InputRegions;
  readonly getStickMode: () => StickMode;
  readonly getFixedStickCenter: () => Vec2;
  readonly onStickVisual: (visual: StickVisual | null) => void;
  readonly config: GameConfig;
}

const MAX_POINTERS = 5;

export class PointerInputAdapter {
  private readonly pointers = new Map<number, TrackedPointer>();
  private readonly queue: InputCommand[] = [];
  private stickCenter: Vec2 | null = null;
  private enabled = true;
  private readonly listeners: [string, EventListener][] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly options: PointerInputOptions,
  ) {
    this.listen('pointerdown', (e) => this.onDown(e as PointerEvent));
    this.listen('pointermove', (e) => this.onMove(e as PointerEvent));
    this.listen('pointerup', (e) => this.onUp(e as PointerEvent));
    this.listen('pointercancel', (e) => this.onUp(e as PointerEvent));
    this.listen('lostpointercapture', (e) => this.onUp(e as PointerEvent));
    this.listen('wheel', (e) => this.onWheel(e as WheelEvent));
    this.listen('contextmenu', (e) => e.preventDefault());
    root.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  private listen(type: string, handler: EventListener): void {
    this.root.addEventListener(type, handler, {
      passive: type !== 'wheel' && type !== 'contextmenu',
    });
    this.listeners.push([type, handler]);
  }

  dispose(): void {
    for (const [type, handler] of this.listeners) this.root.removeEventListener(type, handler);
  }

  /** 蓄積したコマンドを取り出す(毎フレーム 1 回)。 */
  drain(): InputCommand[] {
    const out = this.queue.splice(0, this.queue.length);
    return out;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancelAll();
  }

  /** 向き切替・一時停止時の強制解放(F09 手順 1)。以降は新しいタッチのみ受け付ける。 */
  cancelAll(): void {
    this.pointers.clear();
    this.stickCenter = null;
    this.queue.length = 0;
    this.options.onStickVisual(null);
    this.queue.push({ type: 'Move', x: 0, y: 0 });
  }

  private onDown(e: PointerEvent): void {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse') {
      this.onMouseDown(e);
      return;
    }
    if (this.pointers.size >= MAX_POINTERS) return;
    const role = this.assignRole({ x: e.clientX, y: e.clientY });
    this.pointers.set(e.pointerId, { role, x: e.clientX, y: e.clientY });
    if (role === 'stick') this.startStick({ x: e.clientX, y: e.clientY });
  }

  private onMouseDown(e: PointerEvent): void {
    if (e.button === 0) {
      this.queue.push({ type: 'AttackPressed' });
      return;
    }
    if (e.button === 2) {
      e.preventDefault();
      this.pointers.set(e.pointerId, { role: 'camera', x: e.clientX, y: e.clientY });
    }
  }

  private assignRole(p: Vec2): PointerRole {
    const regions = this.options.getRegions();
    const hasStick = [...this.pointers.values()].some((t) => t.role === 'stick');
    if (!hasStick && rectContains(regions.stick, p)) {
      if (this.options.getStickMode() === 'fixed') {
        const center = this.options.getFixedStickCenter();
        return canStartFixedStick(center, p, this.options.config.stick) ? 'stick' : 'dead';
      }
      return 'stick';
    }
    if (rectContains(regions.camera, p)) {
      const cameraPointers = [...this.pointers.values()].filter((t) => t.role === 'camera');
      if (cameraPointers.length === 0) return 'camera';
      if (cameraPointers.length === 1) {
        for (const t of this.pointers.values()) if (t.role === 'camera') t.role = 'pinch';
        return 'pinch';
      }
    }
    return 'dead';
  }

  private startStick(p: Vec2): void {
    this.stickCenter =
      this.options.getStickMode() === 'fixed' ? this.options.getFixedStickCenter() : p;
    this.emitStick(p);
  }

  private emitStick(p: Vec2): void {
    if (!this.stickCenter) return;
    const input = computeStickInput(this.stickCenter, p, this.options.config.stick);
    this.queue.push({ type: 'Move', x: input.x * input.magnitude, y: input.y * input.magnitude });
    this.options.onStickVisual({
      center: this.stickCenter,
      knob: knobPosition(this.stickCenter, p, this.options.config.stick.outerRadiusPx),
    });
  }

  private onMove(e: PointerEvent): void {
    const t = this.pointers.get(e.pointerId);
    if (!t || !this.enabled) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (t.role === 'pinch') this.emitPinch(e, t);
    t.x = e.clientX;
    t.y = e.clientY;
    if (t.role === 'stick') this.emitStick({ x: e.clientX, y: e.clientY });
    if (t.role === 'camera' && (dx !== 0 || dy !== 0)) this.queue.push({ type: 'Look', dx, dy });
  }

  private emitPinch(e: PointerEvent, moving: TrackedPointer): void {
    const other = [...this.pointers.entries()].find(
      ([id, t]) => id !== e.pointerId && t.role === 'pinch',
    )?.[1];
    if (!other) return;
    const before = Math.hypot(moving.x - other.x, moving.y - other.y);
    const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
    const delta = pinchDeltaToZoom(after - before, this.options.config.camera);
    if (delta !== 0) this.queue.push({ type: 'Zoom', delta });
  }

  private onUp(e: PointerEvent): void {
    const t = this.pointers.get(e.pointerId);
    if (!t) return;
    this.pointers.delete(e.pointerId);
    switch (t.role) {
      case 'stick':
        this.stickCenter = null;
        this.queue.push({ type: 'Move', x: 0, y: 0 });
        this.options.onStickVisual(null);
        break;
      case 'camera':
        this.queue.push({ type: 'LookEnd' });
        break;
      case 'pinch':
        // ピンチ中に 1 本離した場合、残る指は離すまで無効
        for (const rest of this.pointers.values()) if (rest.role === 'pinch') rest.role = 'dead';
        break;
      default:
        break;
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (!this.enabled || e.deltaY === 0) return;
    this.queue.push({
      type: 'Zoom',
      delta: wheelToZoom(Math.sign(e.deltaY), this.options.config.camera),
    });
  }
}
