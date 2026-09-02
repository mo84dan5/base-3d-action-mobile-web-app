import { advanceLoop, initialAccumulator, type LoopAccumulator } from '../application/gameLoop';
import { GameSession } from '../application/gameSession';
import type { Clock, EffectPort, SettingsStore } from '../application/ports';
import {
  initialScreenFlow,
  reduceScreenFlow,
  type ScreenEvent,
  type ScreenFlowState,
} from '../application/screenFlow';
import type { ViewState } from '../application/viewState';
import { FIXED_STEP_SECONDS, defaultConfig, type GameConfig } from '../domain/config/gameConfig';
import { ButtonInputSet } from '../domain/input/buttonPressTracker';
import type { InputCommand } from '../domain/input/inputCommand';
import {
  computeInputRegions,
  fixedStickCenter,
  type InputRegions,
  type Orientation,
  type ViewportSize,
} from '../domain/orientation/orientation';
import { parseSettings, serializeSettings, type Settings } from '../domain/settings/settings';
import { stageLayout } from '../domain/stage/stageLayout';
import { CompositeEffectPort } from '../infrastructure/device/compositeEffectPort';
import { NavigatorVibration } from '../infrastructure/device/navigatorVibration';
import { NullSoundPlayer } from '../infrastructure/device/nullSoundPlayer';
import {
  OrientationWatcher,
  type ViewportChange,
} from '../infrastructure/device/orientationWatcher';
import { PerformanceClock } from '../infrastructure/device/performanceClock';
import { KeyboardInputAdapter } from '../infrastructure/input/keyboardInputAdapter';
import { PointerInputAdapter } from '../infrastructure/input/pointerInputAdapter';
import { LocalStorageSettingsStore } from '../infrastructure/storage/localStorageSettingsStore';
import { BvhTerrainCollider } from '../infrastructure/three/bvhTerrainCollider';
import { GameRenderer } from '../infrastructure/three/gameRenderer';
import { Hud } from '../ui/hud';
import { PauseMenu } from '../ui/pauseMenu';
import { ResultScreen } from '../ui/resultScreen';
import { TitleScreen } from '../ui/titleScreen';

// 配線(依存の注入)。画面遷移・更新ループ・向き切替・visibilitychange をここで結ぶ。

const DEV = import.meta.env.DEV;

export class GameApp {
  private readonly config: GameConfig = defaultConfig;
  private settings: Settings;
  private readonly store: SettingsStore = new LocalStorageSettingsStore();
  private readonly clock: Clock = new PerformanceClock();
  private readonly buttons = new ButtonInputSet(defaultConfig.action);
  private flow: ScreenFlowState = initialScreenFlow;
  private session: GameSession | null = null;
  private renderer: GameRenderer | null = null;
  private terrain: BvhTerrainCollider | null = null;
  private effects: EffectPort | null = null;
  private accumulator: LoopAccumulator = initialAccumulator;
  /** 物理ステップが走らなかったフレームの入力を次のステップまで保持する */
  private pendingCommands: InputCommand[] = [];
  private prevView: ViewState | null = null;
  private currView: ViewState | null = null;
  private lastFrameTime = 0;
  private fpsAccum = { frames: 0, time: 0, fps: 0 };
  private viewport: ViewportSize = { width: 1, height: 1 };
  private orientation: Orientation = 'landscape';
  private regions: InputRegions;
  private readonly canvas: HTMLCanvasElement;
  private readonly title: TitleScreen;
  private readonly hud: Hud;
  private readonly pause: PauseMenu;
  private readonly result: ResultScreen;
  private pointer: PointerInputAdapter | null = null;
  private keyboard: KeyboardInputAdapter | null = null;
  private watcher: OrientationWatcher | null = null;

  constructor(private readonly root: HTMLElement) {
    // F06: WebGLRenderer 生成前に設定を読み込む
    this.settings = parseSettings(this.store.load());
    this.regions = computeInputRegions(1, 1, 'landscape');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'scene-canvas';
    this.canvas.dataset.testid = 'scene';
    this.title = new TitleScreen(__APP_VERSION__, () => this.dispatch({ type: 'startPressed' }));
    this.hud = new Hud(this.buttons, {
      now: () => this.clock.now(),
      onButtonPress: () => this.effects?.trigger({ kind: 'buttonPress' }),
      onPausePressed: () => this.dispatch({ type: 'pausePressed' }),
    });
    this.pause = new PauseMenu(this.settings, {
      onChange: (s) => this.applySettings(s),
      onResume: () => this.dispatch({ type: 'resumePressed' }),
      onTitle: () => this.dispatch({ type: 'titlePressed' }),
    });
    this.result = new ResultScreen(
      () => this.dispatch({ type: 'retryPressed' }),
      () => this.dispatch({ type: 'titlePressed' }),
    );
    this.hud.el.hidden = true;
    this.pause.el.hidden = true;
    this.result.el.hidden = true;
    root.append(this.canvas, this.hud.el, this.pause.el, this.result.el, this.title.el);
  }

  start(): void {
    if (new URLSearchParams(location.search).has('debug')) this.exposeDebugHook();
    this.watcher = new OrientationWatcher((c) => this.onViewportChange(c));
    document.addEventListener('visibilitychange', () => this.onVisibilityChange());
    if (!this.supportsWebGl2()) {
      this.title.setUnsupported();
      return;
    }
    this.loadAssets().catch(() => {
      this.dispatch({ type: 'assetsFailed' });
      this.title.setFailed();
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  /** E2E・実機確認用。`?debug=1` のときだけ window に読み取り専用の状態を公開する。 */
  private exposeDebugHook(): void {
    const hook = {
      view: () => this.session?.view() ?? null,
      screen: () => this.flow.screen,
      settings: () => this.settings,
    };
    (window as unknown as { __b3dDebug: typeof hook }).__b3dDebug = hook;
  }

  private supportsWebGl2(): boolean {
    try {
      return document.createElement('canvas').getContext('webgl2') !== null;
    } catch {
      return false;
    }
  }

  /** 3D 資産の準備。外部アセットは持たないため、レンダラ・ステージ・BVH の生成を段階として進捗に出す。 */
  private async loadAssets(): Promise<void> {
    const total = 3;
    const yieldFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    this.title.setProgress(0, total);
    await yieldFrame();
    const renderer = new GameRenderer(this.canvas, this.config, stageLayout, this.settings.quality);
    this.renderer = renderer;
    renderer.resize(this.viewport, this.orientation);
    this.title.setProgress(1, total);
    await yieldFrame();
    this.terrain = new BvhTerrainCollider(renderer.collisionGeometry);
    this.title.setProgress(2, total);
    await yieldFrame();
    this.effects = new CompositeEffectPort([
      renderer.vfx,
      new NullSoundPlayer(),
      new NavigatorVibration(this.config.action.buttonPressVibrationMs),
    ]);
    this.pointer = new PointerInputAdapter(this.root, {
      getRegions: () => this.regions,
      getStickMode: () => this.settings.stickMode,
      getFixedStickCenter: () =>
        fixedStickCenter(
          this.viewport.width,
          this.viewport.height,
          this.orientation,
          this.config.stick,
        ),
      onStickVisual: (v) => {
        if (v) this.hud.setStick(v);
        else this.hud.setStick(null);
        if (!v && this.settings.stickMode === 'fixed') this.showFixedStick();
      },
      config: this.config,
    });
    this.keyboard = new KeyboardInputAdapter(window, this.buttons, () => this.clock.now());
    this.title.setProgress(3, total);
    this.title.setLoaded();
    this.dispatch({ type: 'assetsLoaded' });
  }

  private dispatch(event: ScreenEvent): void {
    const before = this.flow;
    this.flow = reduceScreenFlow(this.flow, event);
    if (this.flow === before) return;
    if (this.flow.needsNewSession) this.createSession();
    if (before.screen === 'play' && this.flow.screen !== 'play') this.cancelInputs();
    if (before.screen !== 'title' && this.flow.screen === 'title') this.session = null;
    if (this.flow.screen === 'pause' && before.screen !== 'pause') this.hud.cancelAllButtons();
    this.applyScreen();
  }

  private createSession(): void {
    if (!this.terrain || !this.effects) return;
    this.session = new GameSession({
      terrain: this.terrain,
      effects: this.effects,
      rng: Math.random,
      config: this.config,
      stage: stageLayout,
    });
    this.accumulator = initialAccumulator;
    this.pendingCommands = [];
    this.currView = this.session.view();
    this.prevView = this.currView;
    this.dispatch({ type: 'sessionCreated' });
  }

  private applyScreen(): void {
    const s = this.flow.screen;
    if (s === 'title') this.title.show();
    else this.title.hide();
    this.hud.el.hidden = s === 'title';
    if (s === 'pause') this.pause.show();
    else this.pause.hide();
    if (s === 'result' && this.session?.result)
      this.result.show(this.session.result, this.session.stats);
    else this.result.hide();
    this.pointer?.setEnabled(s === 'play');
    if (s === 'play') {
      this.hud.setShowFps(this.settings.showFps);
      if (this.settings.stickMode === 'fixed') this.showFixedStick();
      else this.hud.setStick(null, true);
    }
  }

  private showFixedStick(): void {
    this.hud.setFixedStick(
      fixedStickCenter(
        this.viewport.width,
        this.viewport.height,
        this.orientation,
        this.config.stick,
      ),
    );
  }

  /** F09 手順 1 / S02 一時停止: 押下中のポインタをすべてキャンセル扱いにする。 */
  private cancelInputs(): void {
    this.pointer?.cancelAll();
    this.keyboard?.cancelAll();
    this.hud.cancelAllButtons();
    const holdEnds = this.buttons.cancelAll();
    this.session?.cancelInputs();
    if (this.session && holdEnds.length > 0) this.session.step(holdEnds, this.settings, 0);
  }

  private onViewportChange(change: ViewportChange): void {
    this.viewport = change.size;
    this.orientation = change.orientation;
    if (change.orientationChanged && this.flow.screen === 'play') this.cancelInputs();
    this.regions = computeInputRegions(change.size.width, change.size.height, change.orientation);
    this.renderer?.resize(change.size, change.orientation);
    if (this.flow.screen !== 'title' && this.settings.stickMode === 'fixed') this.showFixedStick();
    if (!this.flow.running && this.flow.screen !== 'title') this.renderer?.renderOnce();
  }

  private onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      this.dispatch({ type: 'hidden', sessionEnding: this.session?.phase === 'ending' });
      return;
    }
    this.dispatch({ type: 'visible' });
  }

  private applySettings(next: Settings): void {
    const prev = this.settings;
    this.settings = next;
    this.store.save(serializeSettings(next));
    if (prev.quality !== next.quality) this.renderer?.applyQuality(next.quality);
    this.hud.setShowFps(next.showFps);
    if (next.stickMode === 'fixed') this.showFixedStick();
    else this.hud.setStick(null, true);
  }

  private collectCommands(): InputCommand[] {
    const now = this.clock.now();
    return [
      ...(this.pointer?.drain() ?? []),
      ...(this.keyboard?.drain() ?? []),
      ...this.hud.drainCommands(),
      ...this.buttons.flush(now),
    ];
  }

  private frame(time: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const frameDt =
      this.lastFrameTime === 0 ? 0 : Math.min(0.25, (time - this.lastFrameTime) / 1000);
    this.lastFrameTime = time;
    this.updateFps(frameDt);
    if (!this.renderer) return;
    const session = this.session;
    if (this.flow.running && session) {
      this.pendingCommands.push(...this.collectCommands());
      const pausePressed = this.pendingCommands.some((c) => c.type === 'PausePressed');
      const advance = advanceLoop(this.accumulator, frameDt);
      this.accumulator = advance.accumulator;
      for (let i = 0; i < advance.steps; i++) {
        session.step(this.pendingCommands, this.settings);
        this.pendingCommands = [];
        this.prevView = this.currView;
        this.currView = session.view();
      }
      if (advance.steps === 0 && this.currView === null) this.currView = session.view();
      this.renderer.vfx.update(advance.steps * FIXED_STEP_SECONDS);
      if (session.phase === 'ended') this.dispatch({ type: 'sessionEnded' });
      if (pausePressed) this.dispatch({ type: 'pausePressed' });
      this.render(advance.alpha);
      return;
    }
    if (this.flow.screen !== 'title' && this.currView) {
      // 停止中は最後のフレームを保持する(描画しない)
      this.hud.update(
        this.currView,
        this.renderer,
        this.orientation,
        this.viewport.height,
        this.stats(),
      );
    }
  }

  private render(alpha: number): void {
    if (!this.renderer || !this.currView) return;
    const prev = this.prevView ?? this.currView;
    this.renderer.render(prev, this.currView, alpha);
    this.hud.update(
      this.currView,
      this.renderer,
      this.orientation,
      this.viewport.height,
      this.stats(),
    );
  }

  private stats() {
    return {
      fps: this.fpsAccum.fps,
      drawCalls: DEV && this.renderer ? this.renderer.drawCalls() : null,
      vfxCount: DEV && this.renderer ? this.renderer.vfx.activeMeshCount() : null,
    };
  }

  private updateFps(dt: number): void {
    this.fpsAccum.frames++;
    this.fpsAccum.time += dt;
    if (this.fpsAccum.time >= 1) {
      this.fpsAccum.fps = this.fpsAccum.frames / this.fpsAccum.time;
      this.fpsAccum.frames = 0;
      this.fpsAccum.time = 0;
    }
  }
}
