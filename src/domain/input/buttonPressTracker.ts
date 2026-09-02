import type { ActionConfig } from '../config/gameConfig';
import type { InputCommand } from './inputCommand';

// ボタンの押下 / 長押し判定と強制解放(F03 共通の入力判定)。
//
// フレームごとの流れ(フラッシュ方式):
//   1. pointerdown で press(now) — 押下を「保留」として記録する(まだコマンドは出さない)
//   2. 同一フレーム内に cancel() が来れば保留は破棄され、コマンドは発火しない(F03 / F09 の強制解放)
//   3. application が毎フレーム 1 回 flush(now) を呼び、保留中の押下コマンドと、
//      閾値(200 ms)を超えた長押し開始(*HoldStart)を受け取る
//   4. release(now) は長押し開始済みなら *HoldEnd を返す(短押しの概念は無い)
//
// 時刻はすべて秒。

export type ButtonKind = 'attack' | 'skill' | 'burst' | 'jump' | 'sprint' | 'interact' | 'pause';

export const BUTTON_KINDS: readonly ButtonKind[] = [
  'attack',
  'skill',
  'burst',
  'jump',
  'sprint',
  'interact',
  'pause',
];

const PRESS_COMMAND: Readonly<Record<ButtonKind, InputCommand>> = {
  attack: { type: 'AttackPressed' },
  skill: { type: 'SkillPressed' },
  burst: { type: 'BurstPressed' },
  jump: { type: 'JumpPressed' },
  sprint: { type: 'DashPressed' },
  interact: { type: 'InteractPressed' },
  pause: { type: 'PausePressed' },
};

const HOLD_COMMANDS: Partial<
  Readonly<Record<ButtonKind, { readonly start: InputCommand; readonly end: InputCommand }>>
> = {
  skill: { start: { type: 'SkillHoldStart' }, end: { type: 'SkillHoldEnd' } },
  sprint: { start: { type: 'SprintHoldStart' }, end: { type: 'SprintHoldEnd' } },
};

export interface PressResult {
  /** ポインタを消費したか(無効・ロック中でも消費する) */
  readonly consumed: boolean;
  /** 押下がゲームへ届く保留として受け付けられたか */
  readonly accepted: boolean;
}

export class ButtonPressTracker {
  private pressedAt: number | null = null;
  private pendingPress = false;
  private holdStarted = false;
  private enabled = true;
  private lockedUntil = -Infinity;

  constructor(
    readonly kind: ButtonKind,
    private readonly holdThreshold: number,
  ) {}

  /** pointerdown。無効・ロック中・押下中は保留を作らないが、ポインタは消費する。 */
  press(now: number): PressResult {
    if (!this.enabled || now < this.lockedUntil || this.pressedAt !== null) {
      return { consumed: true, accepted: false };
    }
    this.pressedAt = now;
    this.pendingPress = true;
    this.holdStarted = false;
    return { consumed: true, accepted: true };
  }

  /** pointerup。長押し開始済みなら *HoldEnd を返す。保留中の押下は flush で発火させる。 */
  release(): InputCommand[] {
    const commands = this.holdEndIfStarted();
    this.pressedAt = null;
    this.holdStarted = false;
    return commands;
  }

  /** 強制解放(向き切替・一時停止・pointercancel・lostpointercapture)。保留中の押下は破棄する。 */
  cancel(): InputCommand[] {
    const commands = this.holdEndIfStarted();
    this.pressedAt = null;
    this.pendingPress = false;
    this.holdStarted = false;
    return commands;
  }

  /** 毎フレーム 1 回。保留中の押下コマンドと、閾値を超えた長押し開始を返す。 */
  flush(now: number): InputCommand[] {
    const commands: InputCommand[] = [];
    if (this.pendingPress) {
      this.pendingPress = false;
      commands.push(PRESS_COMMAND[this.kind]);
    }
    if (this.shouldStartHold(now)) {
      this.holdStarted = true;
      const hold = HOLD_COMMANDS[this.kind];
      if (hold) commands.push(hold.start);
    }
    return commands;
  }

  isHeld(): boolean {
    return this.pressedAt !== null;
  }

  hasHoldStarted(): boolean {
    return this.holdStarted;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** 出現直後のロック。now から seconds の間は押下を無視する。 */
  lockFor(seconds: number, now: number): void {
    this.lockedUntil = now + seconds;
  }

  private shouldStartHold(now: number): boolean {
    if (this.pressedAt === null || this.holdStarted) return false;
    if (!HOLD_COMMANDS[this.kind]) return false;
    return now - this.pressedAt >= this.holdThreshold;
  }

  private holdEndIfStarted(): InputCommand[] {
    if (!this.holdStarted) return [];
    const hold = HOLD_COMMANDS[this.kind];
    return hold ? [hold.end] : [];
  }
}

/** 全ボタンぶんのトラッカーをまとめて扱う。 */
export class ButtonInputSet {
  private readonly trackers: ReadonlyMap<ButtonKind, ButtonPressTracker>;

  constructor(config: Pick<ActionConfig, 'holdThreshold'>) {
    this.trackers = new Map(
      BUTTON_KINDS.map((kind) => [kind, new ButtonPressTracker(kind, config.holdThreshold)]),
    );
  }

  get(kind: ButtonKind): ButtonPressTracker {
    const tracker = this.trackers.get(kind);
    if (!tracker) throw new Error(`unknown button: ${kind}`);
    return tracker;
  }

  press(kind: ButtonKind, now: number): PressResult {
    return this.get(kind).press(now);
  }

  release(kind: ButtonKind): InputCommand[] {
    return this.get(kind).release();
  }

  cancel(kind: ButtonKind): InputCommand[] {
    return this.get(kind).cancel();
  }

  /** 押下中のすべてのボタンを強制解放し、発生した *HoldEnd を返す。 */
  cancelAll(): InputCommand[] {
    return [...this.trackers.values()].flatMap((tracker) => tracker.cancel());
  }

  /** 全ボタンの flush をまとめて行う。 */
  flush(now: number): InputCommand[] {
    return [...this.trackers.values()].flatMap((tracker) => tracker.flush(now));
  }

  setEnabled(kind: ButtonKind, enabled: boolean): void {
    this.get(kind).setEnabled(enabled);
  }

  lockFor(kind: ButtonKind, seconds: number, now: number): void {
    this.get(kind).lockFor(seconds, now);
  }
}
