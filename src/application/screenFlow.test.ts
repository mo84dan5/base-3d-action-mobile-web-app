import { describe, expect, it } from 'vitest';
import {
  initialScreenFlow,
  reduceScreenFlow,
  type ScreenEvent,
  type ScreenFlowState,
} from './screenFlow';

function run(events: ScreenEvent[], start: ScreenFlowState = initialScreenFlow): ScreenFlowState {
  return events.reduce(reduceScreenFlow, start);
}

describe('画面遷移(画面遷移図)', () => {
  it('読み込み完了前は「はじめる」で遷移しない', () => {
    expect(run([{ type: 'startPressed' }]).screen).toBe('title');
  });
  it('読み込み完了後に「はじめる」で S02 へ遷移し、更新ループが動き、新規セッションを要求する', () => {
    const s = run([{ type: 'assetsLoaded' }, { type: 'startPressed' }]);
    expect(s.screen).toBe('play');
    expect(s.running).toBe(true);
    expect(s.needsNewSession).toBe(true);
    expect(reduceScreenFlow(s, { type: 'sessionCreated' }).needsNewSession).toBe(false);
  });
  it('ポーズボタンで S03 へ遷移し更新ループが停止、再開で S02 に戻る', () => {
    const s = run([{ type: 'assetsLoaded' }, { type: 'startPressed' }, { type: 'pausePressed' }]);
    expect(s.screen).toBe('pause');
    expect(s.running).toBe(false);
    const r = reduceScreenFlow(s, { type: 'resumePressed' });
    expect(r.screen).toBe('play');
    expect(r.running).toBe(true);
  });
  it('S02 表示中の hidden は S03 へ遷移し、visible に戻っても自動再開しない', () => {
    const s = run([
      { type: 'assetsLoaded' },
      { type: 'startPressed' },
      { type: 'hidden', sessionEnding: false },
    ]);
    expect(s.screen).toBe('pause');
    expect(reduceScreenFlow(s, { type: 'visible' }).screen).toBe('pause');
  });
  it('S04 表示待ちの演出中の hidden は S03 へ遷移せず演出を止め、visible で再開する', () => {
    const s = run([
      { type: 'assetsLoaded' },
      { type: 'startPressed' },
      { type: 'hidden', sessionEnding: true },
    ]);
    expect(s.screen).toBe('play');
    expect(s.running).toBe(false);
    expect(s.endingSuspended).toBe(true);
    const v = reduceScreenFlow(s, { type: 'visible' });
    expect(v.running).toBe(true);
    expect(v.endingSuspended).toBe(false);
  });
  it('S01・S03・S04 表示中の hidden は無視する', () => {
    expect(run([{ type: 'hidden', sessionEnding: false }]).screen).toBe('title');
    const paused = run([
      { type: 'assetsLoaded' },
      { type: 'startPressed' },
      { type: 'pausePressed' },
    ]);
    expect(reduceScreenFlow(paused, { type: 'hidden', sessionEnding: false })).toEqual(paused);
  });
  it('セッション終了で S04 へ、再挑戦で新規セッションの S02 へ、タイトルへ戻るで S01 へ', () => {
    const s = run([
      { type: 'assetsLoaded' },
      { type: 'startPressed' },
      { type: 'sessionCreated' },
      { type: 'sessionEnded' },
    ]);
    expect(s.screen).toBe('result');
    expect(s.running).toBe(false);
    const retry = reduceScreenFlow(s, { type: 'retryPressed' });
    expect(retry.screen).toBe('play');
    expect(retry.needsNewSession).toBe(true);
    const title = reduceScreenFlow(s, { type: 'titlePressed' });
    expect(title.screen).toBe('title');
    expect(title.assetsLoaded).toBe(true);
  });
  it('S03 からタイトルへ戻れる', () => {
    const s = run([
      { type: 'assetsLoaded' },
      { type: 'startPressed' },
      { type: 'pausePressed' },
      { type: 'titlePressed' },
    ]);
    expect(s.screen).toBe('title');
  });
});
