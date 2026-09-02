import { formatClearTime, type GameResult, type Stats } from '../domain/combat/result';
import { el, forceReflow, onPress } from './dom';

// S04 リザルト。勝利 / 敗北、統計、再挑戦・タイトルへ戻る。
export class ResultScreen {
  readonly el: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly timeLabel: HTMLElement;
  private readonly timeValue: HTMLElement;
  private readonly defeated: HTMLElement;
  private readonly damage: HTMLElement;

  constructor(onRetry: () => void, onTitle: () => void) {
    this.el = el('section', 'screen result-screen');
    this.el.dataset.screen = 'result';
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    const column = el('div', 'result-column');
    this.heading = el('h2', 'result-heading', '');
    this.heading.dataset.testid = 'result-heading';
    const stats = el('div', 'stats');
    this.timeLabel = el('span', '', 'クリアタイム');
    this.timeValue = el('span', '', '00:00.00');
    this.timeValue.dataset.testid = 'result-time';
    this.defeated = el('span', '', '0 / 2');
    this.defeated.dataset.testid = 'result-defeated';
    this.damage = el('span', '', '0');
    this.damage.dataset.testid = 'result-damage';
    stats.append(
      this.timeLabel,
      this.timeValue,
      el('span', '', '撃破数'),
      this.defeated,
      el('span', '', '被ダメージ'),
      this.damage,
    );
    const buttons = el('div', 'result-buttons');
    const retry = el('button', 'btn primary', '再挑戦');
    retry.dataset.testid = 'retry';
    onPress(retry, onRetry);
    const title = el('button', 'btn', 'タイトルへ戻る');
    title.dataset.testid = 'result-title';
    onPress(title, onTitle);
    buttons.append(retry, title);
    column.append(this.heading, stats, buttons);
    this.el.append(column);
  }

  show(result: GameResult, stats: Stats): void {
    this.el.hidden = false;
    this.el.classList.toggle('victory', result === 'victory');
    this.el.classList.toggle('defeat', result === 'defeat');
    this.heading.textContent = result === 'victory' ? '勝利' : '敗北';
    this.heading.style.animation = 'none';
    forceReflow(this.heading);
    this.heading.style.animation = '';
    this.timeLabel.textContent = result === 'victory' ? 'クリアタイム' : '経過時間';
    this.timeValue.textContent = formatClearTime(stats.clearTime);
    this.defeated.textContent = `${stats.defeated} / ${stats.totalTargets}`;
    this.damage.textContent = String(stats.damageTaken);
  }

  hide(): void {
    this.el.hidden = true;
  }
}
