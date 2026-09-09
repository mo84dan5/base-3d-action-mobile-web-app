import type { ScreenProjector } from '../application/ports';
import type { DamageNumberView, ViewState } from '../application/viewState';
import { EQUIPMENT_SLOTS, SLOT_LABELS, type EquipmentSlot } from '../domain/equipment/equipment';
import type { ButtonInputSet, ButtonKind } from '../domain/input/buttonPressTracker';
import type { Vec2 } from '../domain/math/vec2';
import type { Orientation } from '../domain/orientation/orientation';
import { el, forceReflow } from './dom';

// S02 HUD。3D シーンの上に重ねる DOM。ボタンは pointerdown で反応し、ポインタを消費する(S02 入力の優先順位)。

export interface HudCallbacks {
  readonly now: () => number;
  readonly onButtonPress: () => void;
  readonly onPausePressed: () => void;
}

interface ActionButton {
  readonly kind: ButtonKind;
  readonly el: HTMLButtonElement;
  readonly label: HTMLElement;
  readonly ring?: HTMLElement;
  readonly cdLabel?: HTMLElement;
}

export interface HudStats {
  readonly fps: number;
  readonly drawCalls: number | null;
  readonly vfxCount: number | null;
}

export class Hud {
  readonly el: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpGhost: HTMLElement;
  private readonly hpBar: HTMLElement;
  private readonly hpLabel: HTMLElement;
  private readonly playerDamage: HTMLElement;
  private readonly staminaBar: HTMLElement;
  private staminaRow!: HTMLElement;
  private readonly staminaFill: HTMLElement;
  private readonly energyBar: HTMLElement;
  private readonly energyFill: HTMLElement;
  private readonly energyLabel: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly styleName: HTMLElement;
  private readonly styleSub: HTMLElement;
  private readonly beatDot: HTMLElement;
  private lastStyleText = '';
  private lastStyleSub = '';
  private readonly countdown: HTMLElement;
  private readonly indicator: HTMLElement;
  private readonly interactMessage: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly stickKnob: HTMLElement;
  private readonly worldLayer: HTMLElement;
  private readonly buttons = new Map<ButtonKind, ActionButton>();
  private readonly damageEls = new Map<number, HTMLElement>();
  private readonly enemyHpEls = new Map<number, { root: HTMLElement; fill: HTMLElement }>();
  private lastHp = -1;
  private lastStamina = -1;
  private lastCountdown: string | null = null;
  private lastPlayerDamageId = -1;
  private hpFlashUntil = 0;
  private showFps = false;

  constructor(
    private readonly input: ButtonInputSet,
    private readonly callbacks: HudCallbacks,
  ) {
    this.el = el('section', 'screen hud');
    this.el.dataset.screen = 'play';
    this.worldLayer = el('div', 'world-layer');
    const hudLayer = el('div', 'hud-layer');
    this.el.append(this.worldLayer, hudLayer);

    const top = el('div', 'hud-top');
    const bars = el('div', 'bars');
    const hpRow = el('div', 'bar-row hp');
    this.hpBar = el('div', 'bar hp');
    this.hpBar.dataset.testid = 'hp-bar';
    this.hpGhost = el('div', 'bar-ghost');
    this.hpFill = el('div', 'bar-fill');
    this.hpBar.append(this.hpGhost, this.hpFill);
    this.hpLabel = el('span', 'bar-label value', '100/100');
    this.playerDamage = el('span', 'player-damage');
    hpRow.append(el('span', 'bar-label lead', 'HP'), this.hpBar, this.hpLabel, this.playerDamage);
    const stRow = el('div', 'bar-row st');
    stRow.dataset.testid = 'stamina-row';
    this.staminaRow = stRow;
    this.staminaBar = el('div', 'bar stamina hidden');
    this.staminaBar.dataset.testid = 'stamina-bar';
    this.staminaFill = el('div', 'bar-fill');
    this.staminaBar.append(this.staminaFill);
    stRow.append(el('span', 'bar-label lead', 'ST'), this.staminaBar);
    // エネルギーバー(S02 要素 18)。バーストのリングだけでは蓄積・消費がわかりにくいため常時表示する
    const enRow = el('div', 'bar-row en');
    enRow.dataset.testid = 'energy-row';
    this.energyBar = el('div', 'bar energy');
    this.energyBar.dataset.testid = 'energy-bar';
    this.energyFill = el('div', 'bar-fill');
    this.energyBar.append(this.energyFill);
    this.energyLabel = el('span', 'bar-label value', '0/100');
    this.energyLabel.dataset.testid = 'energy-label';
    enRow.append(el('span', 'bar-label lead', 'EN'), this.energyBar, this.energyLabel);
    // 攻撃スタイル(F11): 名称と、残弾 / ヒット数 / 拍などの補助表示
    const styleRow = el('div', 'style-row');
    styleRow.dataset.testid = 'style-row';
    this.styleName = el('span', 'style-name', '');
    this.styleName.dataset.testid = 'style-name';
    this.styleSub = el('span', 'style-sub', '');
    this.styleSub.dataset.testid = 'style-sub';
    this.beatDot = el('span', 'beat-dot');
    this.beatDot.hidden = true;
    styleRow.append(this.styleName, this.styleSub, this.beatDot);
    bars.append(hpRow, stRow, enRow, styleRow);
    const right = el('div', 'hud-top-right');
    this.fpsEl = el('div', 'fps');
    this.fpsEl.hidden = true;
    const pause = el('button', 'pause-btn touchable', '||');
    pause.dataset.testid = 'pause';
    pause.setAttribute('aria-label', 'ポーズ');
    pause.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      this.callbacks.onButtonPress();
      this.callbacks.onPausePressed();
    });
    right.append(this.fpsEl, pause);
    top.append(bars, right);

    this.countdown = el('div', 'countdown');
    this.countdown.dataset.testid = 'countdown';
    this.indicator = el('div', 'indicator');
    this.indicator.dataset.testid = 'indicator';
    this.indicator.append(el('span'));
    this.interactMessage = el('div', 'interact-message');
    this.interactMessage.hidden = true;
    this.interactMessage.append(el('span'));

    this.stick = el('div', 'stick');
    this.stick.dataset.testid = 'stick';
    this.stickKnob = el('div', 'stick-knob');
    this.stick.append(this.stickKnob);

    const group = el('div', 'action-buttons');
    group.dataset.testid = 'action-buttons';
    group.append(
      this.button('interact', 'インタラクト', 'interact', false),
      this.button('head', '頭', 'head technique', true),
      this.button('leftArm', '左腕', 'left-arm technique', true),
      this.button('burst', 'バースト', 'burst', true),
      this.button('jump', 'ジャンプ', 'jump', false),
      this.button('attack', '攻撃', 'attack technique', true),
      this.button('sprint', 'スプリント', 'sprint', false),
    );
    hudLayer.append(top, this.countdown, this.indicator, this.interactMessage, this.stick, group);
  }

  private button(kind: ButtonKind, text: string, cls: string, ring: boolean): HTMLButtonElement {
    const b = el('button', `action-btn touchable ${cls}`);
    b.dataset.testid = `btn-${kind}`;
    const label = el('span', 'label', text);
    b.append(label);
    const entry: ActionButton = { kind, el: b, label };
    if (ring) {
      const r = el('div', 'ring');
      const cd = el('span', 'cd-label');
      b.append(r, cd);
      this.buttons.set(kind, { ...entry, ring: r, cdLabel: cd });
    } else {
      this.buttons.set(kind, entry);
    }
    const release = () => {
      b.classList.remove('pressed');
      for (const c of this.input.release(kind)) this.pendingCommands.push(c);
    };
    const cancel = () => {
      b.classList.remove('pressed');
      for (const c of this.input.cancel(kind)) this.pendingCommands.push(c);
    };
    b.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      try {
        b.setPointerCapture(e.pointerId);
      } catch {
        // 合成イベントなど capture できないポインタは無視する
      }
      const result = this.input.press(kind, this.callbacks.now());
      if (!result.accepted) return;
      b.classList.add('pressed');
      this.callbacks.onButtonPress();
    });
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', cancel);
    b.addEventListener('lostpointercapture', (e) => {
      if (b.classList.contains('pressed') && e.type === 'lostpointercapture') cancel();
    });
    return b;
  }

  /** ボタンの解放で発生した *HoldEnd(flush と同じ経路で application へ渡す) */
  readonly pendingCommands: import('../domain/input/inputCommand').InputCommand[] = [];

  drainCommands(): import('../domain/input/inputCommand').InputCommand[] {
    return this.pendingCommands.splice(0, this.pendingCommands.length);
  }

  /** 強制解放(向き切替・一時停止)。押下表示も戻す。 */
  cancelAllButtons(): void {
    for (const b of this.buttons.values()) b.el.classList.remove('pressed');
    this.setStick(null, true);
  }

  setShowFps(show: boolean): void {
    this.showFps = show;
    this.fpsEl.hidden = !show;
  }

  setStick(visual: { center: Vec2; knob: Vec2 } | null, instant = false): void {
    this.stick.classList.toggle('instant', instant);
    if (!visual) {
      this.stick.classList.remove('visible');
      return;
    }
    this.stick.classList.add('visible');
    this.stick.style.left = `${visual.center.x}px`;
    this.stick.style.top = `${visual.center.y}px`;
    this.stickKnob.style.transform = `translate(${visual.knob.x - visual.center.x}px, ${visual.knob.y - visual.center.y}px)`;
  }

  /** 固定モードのスティック表示。 */
  setFixedStick(center: Vec2 | null): void {
    if (!center) return;
    this.setStick({ center, knob: center }, true);
  }

  update(
    view: ViewState,
    projector: ScreenProjector,
    orientation: Orientation,
    viewportHeight: number,
    stats: HudStats,
  ): void {
    this.updateBars(view);
    this.updateButtons(view);
    this.updateOverlays(view);
    this.updateWorldLayer(view, projector, orientation, viewportHeight);
    if (this.showFps) {
      const extra =
        stats.drawCalls !== null ? ` / ${stats.drawCalls} calls / vfx ${stats.vfxCount ?? 0}` : '';
      this.fpsEl.textContent = `${Math.round(stats.fps)} fps${extra}`;
    }
  }

  private updateBars(view: ViewState): void {
    const p = view.player;
    const ratio = p.hp / p.maxHp;
    this.hpFill.style.transform = `scaleX(${ratio})`;
    if (p.hp < this.lastHp) {
      this.hpGhost.style.transition = 'none';
      this.hpGhost.style.transform = `scaleX(${this.lastHp / p.maxHp})`;
      forceReflow(this.hpGhost);
      this.hpGhost.style.transition = '';
      this.hpGhost.style.transform = `scaleX(${ratio})`;
      this.hpFlashUntil = view.worldTime + 0.3;
    } else if (this.lastHp < 0) {
      this.hpGhost.style.transform = `scaleX(${ratio})`;
    }
    this.hpBar.classList.toggle('flash', view.worldTime < this.hpFlashUntil);
    this.lastHp = p.hp;
    this.hpLabel.textContent = `${Math.ceil(p.hp)}/${p.maxHp}`;
    const recent = view.hud.recentPlayerDamage;
    if (recent && recent.number.id !== this.lastPlayerDamageId) {
      this.lastPlayerDamageId = recent.number.id;
    }
    this.playerDamage.textContent = recent ? `-${recent.number.amount}` : '';
    this.playerDamage.style.opacity = recent ? String(recent.visual.opacity) : '0';

    const st = p.stamina / p.staminaMax;
    const draining = p.stamina < this.lastStamina - 1e-6;
    this.staminaFill.style.transform = `scaleX(${st})`;
    // スタミナバーは満タン時も常時表示する(S02 要素 3。2026-09-05 変更)
    this.staminaBar.classList.toggle('draining', draining && !p.staminaLow);
    this.staminaBar.classList.toggle('low', p.staminaLow && p.stamina > 0);
    this.staminaBar.classList.toggle('empty', p.stamina <= 0);
    this.lastStamina = p.stamina;

    const hud = view.hud;
    this.energyFill.style.transform = `scaleX(${hud.energyRatio})`;
    this.energyBar.classList.toggle('full', hud.energyFull);
    this.energyBar.classList.toggle('short', hud.energyShort);
    const energyText = `${Math.floor(hud.energy)}/${hud.energyMax}`;
    if (this.energyLabel.textContent !== energyText) this.energyLabel.textContent = energyText;
  }

  private updateButtons(view: ViewState): void {
    const states = view.hud.buttons;
    const set = (kind: ButtonKind, enabled: boolean, label: string) => {
      const b = this.buttons.get(kind);
      if (!b) return;
      b.el.classList.toggle('disabled', !enabled);
      this.input.setEnabled(kind, enabled);
      if (b.label.textContent !== label) b.label.textContent = label;
    };
    set('attack', states.attack.enabled, states.attack.label);
    set('leftArm', states.leftArm.enabled, states.leftArm.label);
    set('head', states.head.enabled, states.head.label);
    set('burst', states.burst.enabled, states.burst.label);
    set('jump', states.jump.enabled, states.jump.label);
    set('sprint', states.sprint.enabled, states.sprint.label);
    const interact = this.buttons.get('interact');
    if (interact) {
      const show = view.hud.interactTargetName !== null;
      if (show && interact.el.hidden) this.input.lockFor('interact', 0.15, this.callbacks.now());
      interact.el.hidden = !show;
      interact.el.classList.toggle('disabled', !states.interact.enabled);
      this.input.setEnabled('interact', states.interact.enabled);
      interact.label.textContent = view.hud.interactTargetName ?? states.interact.label;
    }
    // 技ボタン(F12): 略称と、実行中の技のボタンにタメのリング
    const techniqueButtons: readonly [EquipmentSlot, ButtonKind][] = [
      ['rightArm', 'attack'],
      ['leftArm', 'leftArm'],
      ['head', 'head'],
    ];
    for (const [slot, kind] of techniqueButtons) {
      const b = this.buttons.get(kind);
      if (!b?.ring || !b.cdLabel) continue;
      const short = view.hud.techniques[slot].shortName;
      if (b.cdLabel.textContent !== short) b.cdLabel.textContent = short;
      const ratio = view.hud.activeTechniqueSlot === slot ? view.hud.chargeRatio : 0;
      b.ring.style.setProperty('--ratio', String(ratio));
      b.el.classList.toggle('charging', ratio > 0);
      b.el.classList.toggle('full', ratio >= 1);
    }
    const burst = this.buttons.get('burst');
    if (burst?.ring) {
      burst.ring.style.setProperty('--ratio', String(view.hud.energyRatio));
      burst.el.classList.toggle('full', view.hud.energyFull);
    }
  }

  private updateStyle(view: ViewState): void {
    const style = view.hud.style;
    const t = view.hud.techniques;
    const label = (slot: EquipmentSlot) => {
      const v = t[slot];
      return v.fallbackFrom ? `${v.name}(未実装)` : v.name;
    };
    const text = `右: ${label('rightArm')} / 左: ${label('leftArm')} / 頭: ${label('head')}`;
    if (text !== this.lastStyleText) {
      this.styleName.textContent = text;
      this.lastStyleText = text;
    }
    const parts: string[] = [];
    if (style.rolledName) parts.push(`→ ${style.rolledName}`);
    for (const slot of EQUIPMENT_SLOTS) {
      const ammo = t[slot].ammo;
      if (!ammo) continue;
      parts.push(
        `${SLOT_LABELS[slot]} ${ammo.reloading ? 'リロード中' : `残弾 ${ammo.remaining}/${ammo.capacity}`}`,
      );
    }
    if (style.hitCount !== null) parts.push(`HIT ${style.hitCount}`);
    if (style.guarding) parts.push('ガード');
    const sub = parts.join('  ');
    if (sub !== this.lastStyleSub) {
      this.styleSub.textContent = sub;
      this.lastStyleSub = sub;
    }
    const beat = style.beat;
    this.beatDot.hidden = beat === null;
    if (beat !== null) this.beatDot.classList.toggle('on', beat < 0.2 || beat > 0.8);
  }

  private updateOverlays(view: ViewState): void {
    this.updateStyle(view);
    const label = view.hud.countdownLabel;
    if (label !== this.lastCountdown) {
      this.countdown.replaceChildren();
      if (label) this.countdown.append(el('span', '', label));
      this.lastCountdown = label;
    }
    const indicator = view.hud.indicator;
    this.indicator.classList.toggle('visible', indicator !== null);
    const span = this.indicator.firstElementChild;
    if (span && indicator) span.textContent = indicator === 'climb' ? '崖登り中' : '滑空中';
    const msg = view.hud.interactMessage;
    this.interactMessage.hidden = msg === null;
    const msgSpan = this.interactMessage.firstElementChild;
    if (msgSpan && msg) msgSpan.textContent = msg;
  }

  private updateWorldLayer(
    view: ViewState,
    projector: ScreenProjector,
    orientation: Orientation,
    viewportHeight: number,
  ): void {
    const clampY = (y: number) =>
      orientation === 'portrait' ? Math.min(y, viewportHeight / 2 - 12) : y;
    const alive = new Set<number>();
    for (const d of view.damageNumbers) {
      alive.add(d.number.id);
      this.placeDamage(d, projector, clampY);
    }
    for (const [id, e] of this.damageEls) {
      if (!alive.has(id)) {
        e.remove();
        this.damageEls.delete(id);
      }
    }
    for (const e of view.enemies) {
      let entry = this.enemyHpEls.get(e.id);
      if (!entry) {
        const root = el('div', 'enemy-hp');
        root.dataset.testid = `enemy-hp-${e.id}`;
        const fill = el('div', 'bar-fill');
        root.append(fill);
        this.worldLayer.append(root);
        entry = { root, fill };
        this.enemyHpEls.set(e.id, entry);
      }
      const point = projector.project({ x: e.position.x, y: e.position.y + 2.1, z: e.position.z });
      const show = e.hpBarVisible && point.inFront;
      entry.root.hidden = !show;
      if (!show) continue;
      entry.root.style.transform = `translate(${point.x}px, ${clampY(point.y)}px)`;
      entry.fill.style.transform = `scaleX(${e.hp / e.maxHp})`;
    }
  }

  private placeDamage(
    d: DamageNumberView,
    projector: ScreenProjector,
    clampY: (y: number) => number,
  ): void {
    let e = this.damageEls.get(d.number.id);
    if (!e) {
      e = el('div', `damage-number ${d.number.kind}`, String(d.number.amount));
      e.dataset.testid = 'damage-number';
      this.worldLayer.append(e);
      this.damageEls.set(d.number.id, e);
    }
    const point = projector.project(d.worldPosition);
    e.hidden = !point.inFront;
    e.style.transform = `translate(${point.x}px, ${clampY(point.y)}px) translate(-50%, -50%) scale(${d.visual.scale})`;
    e.style.opacity = String(d.visual.opacity);
  }
}
