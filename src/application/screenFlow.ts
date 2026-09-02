// 画面状態の管理(画面一覧 / 画面遷移図 / S02 一時停止)。DOM に依存しない状態機械。

export type Screen = 'title' | 'play' | 'pause' | 'result';

export interface ScreenFlowState {
  readonly screen: Screen;
  readonly assetsLoaded: boolean;
  readonly loadFailed: boolean;
  /** 更新ループが動いているか */
  readonly running: boolean;
  /** S04 表示待ちの演出中に hidden になり、演出タイマーを止めている */
  readonly endingSuspended: boolean;
  /** セッションを新規作成すべきか(タイトル → プレイ、再挑戦) */
  readonly needsNewSession: boolean;
}

export type ScreenEvent =
  | { readonly type: 'assetsLoaded' }
  | { readonly type: 'assetsFailed' }
  | { readonly type: 'startPressed' }
  | { readonly type: 'pausePressed' }
  | { readonly type: 'hidden'; readonly sessionEnding: boolean }
  | { readonly type: 'visible' }
  | { readonly type: 'resumePressed' }
  | { readonly type: 'titlePressed' }
  | { readonly type: 'retryPressed' }
  | { readonly type: 'sessionEnded' }
  | { readonly type: 'sessionCreated' };

export const initialScreenFlow: ScreenFlowState = {
  screen: 'title',
  assetsLoaded: false,
  loadFailed: false,
  running: false,
  endingSuspended: false,
  needsNewSession: false,
};

export function reduceScreenFlow(s: ScreenFlowState, e: ScreenEvent): ScreenFlowState {
  switch (e.type) {
    case 'assetsLoaded':
      return { ...s, assetsLoaded: true };
    case 'assetsFailed':
      return { ...s, loadFailed: true };
    case 'startPressed':
      if (s.screen !== 'title' || !s.assetsLoaded) return s;
      return { ...s, screen: 'play', running: true, needsNewSession: true, endingSuspended: false };
    case 'sessionCreated':
      return { ...s, needsNewSession: false };
    case 'pausePressed':
      if (s.screen !== 'play') return s;
      return { ...s, screen: 'pause', running: false };
    case 'hidden':
      if (s.screen !== 'play') return s;
      if (e.sessionEnding) return { ...s, running: false, endingSuspended: true };
      return { ...s, screen: 'pause', running: false };
    case 'visible':
      if (s.screen === 'play' && s.endingSuspended)
        return { ...s, running: true, endingSuspended: false };
      return s;
    case 'resumePressed':
      if (s.screen !== 'pause') return s;
      return { ...s, screen: 'play', running: true };
    case 'titlePressed':
      if (s.screen !== 'pause' && s.screen !== 'result') return s;
      return { ...s, screen: 'title', running: false, endingSuspended: false };
    case 'retryPressed':
      if (s.screen !== 'result') return s;
      return { ...s, screen: 'play', running: true, needsNewSession: true };
    case 'sessionEnded':
      if (s.screen !== 'play') return s;
      return { ...s, screen: 'result', running: false, endingSuspended: false };
  }
}
