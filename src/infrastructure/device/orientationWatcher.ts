import {
  detectOrientation,
  isOrientationChange,
  type Orientation,
  type ViewportSize,
} from '../../domain/orientation/orientation';

// 画面向きの監視(F09)。resize / matchMedia change / visibilitychange(visible)を次の rAF で 1 回にまとめて再判定する。
// ゲームの更新ループとは独立した rAF で動く。

export interface ViewportChange {
  readonly size: ViewportSize;
  readonly orientation: Orientation;
  /** 縦横の大小関係が変わった(向きの切替) */
  readonly orientationChanged: boolean;
}

export class OrientationWatcher {
  private size: ViewportSize;
  private scheduled = false;
  private readonly media = window.matchMedia('(orientation: portrait)');
  private readonly onEvent = () => this.schedule();
  private readonly onVisibility = () => {
    if (document.visibilityState === 'visible') this.schedule();
  };

  constructor(private readonly onChange: (change: ViewportChange) => void) {
    this.size = this.read();
    window.addEventListener('resize', this.onEvent);
    this.media.addEventListener('change', this.onEvent);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.apply(true);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onEvent);
    this.media.removeEventListener('change', this.onEvent);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  current(): ViewportSize {
    return this.size;
  }

  orientation(): Orientation {
    return detectOrientation(this.size.width, this.size.height);
  }

  private read(): ViewportSize {
    return {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    };
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.apply(false);
    });
  }

  private apply(initial: boolean): void {
    const next = this.read();
    const changed = initial || isOrientationChange(this.size, next);
    const sameSize = !initial && next.width === this.size.width && next.height === this.size.height;
    this.size = next;
    if (sameSize) return;
    const orientation = detectOrientation(next.width, next.height);
    document.documentElement.dataset.orientation = orientation;
    this.onChange({ size: next, orientation, orientationChanged: changed });
  }
}
