import {
  CATEGORY_LABELS,
  type ActionSpec,
  type AttackStyleDefinition,
  type CostSpec,
  type StyleCategory,
} from '../domain/attackStyle/actionSpec';
import { ATTACK_STYLES, findAttackStyle } from '../domain/attackStyle/attackStyleCatalog';
import {
  EQUIPMENT_SLOTS,
  SLOT_LABELS,
  withSlot,
  type Equipment,
  type EquipmentSlot,
} from '../domain/equipment/equipment';
import { isStyleImplemented } from '../domain/attackStyle/styleResolver';
import { el, onPress } from './dom';

// S05 攻撃スタイル選択モーダル。S03 の「攻撃スタイル」行から開き、系統タブ → 一覧 → 詳細で選ぶ。
// 選択は即時に onSelect で通知し、呼び出し側が保存・反映する。

export interface StyleSelectCallbacks {
  /** 選択中のスロットに即時保存する(F12) */
  readonly onSelect: (slot: EquipmentSlot, id: string) => void;
  readonly onClose: () => void;
}

const CATEGORIES: readonly StyleCategory[] = [
  'sword',
  'strike',
  'polearm',
  'firearm',
  'ranged',
  'magic',
  'placement',
  'defense',
  'movement',
  'special',
];

export function costLabel(cost: CostSpec): string {
  switch (cost.type) {
    case 'none':
      return 'なし';
    case 'stamina':
      return `スタミナ ${cost.amount}`;
    case 'energy':
      return `エネルギー ${cost.amount}`;
    case 'staminaPerSecond':
      return `スタミナ ${cost.rate}/秒`;
    case 'energyPerSecond':
      return `エネルギー ${cost.rate}/秒`;
    case 'allStamina':
      return '全スタミナ';
    case 'hp':
      return `HP ${cost.amount}`;
  }
}

const ACTION_LABELS: Readonly<Record<ActionSpec['kind'], string>> = {
  combo: 'コンボ',
  lunge: '踏み込み',
  hitscan: '射撃',
  charge: 'タメ',
  area: '範囲',
  multihit: '多段',
  projectile: '発射体',
  placed: '設置',
  summon: '召喚',
  guard: 'ガード',
  movement: '移動',
  buff: '強化',
  selfEffect: '自己',
  pull: '引き寄せ',
  random: 'ランダム',
  none: '-',
};

export function actionLabel(spec: ActionSpec): string {
  const base = ACTION_LABELS[spec.kind];
  if (spec.kind === 'charge') return `${base} → ${ACTION_LABELS[spec.release.kind]}`;
  if ((spec.kind === 'movement' || spec.kind === 'buff' || spec.kind === 'pull') && spec.then) {
    return `${base} → ${ACTION_LABELS[spec.then.kind]}`;
  }
  if (spec.kind === 'selfEffect') return `${base} → ${ACTION_LABELS[spec.then.kind]}`;
  return base;
}

export class StyleSelectModal {
  readonly el: HTMLElement;
  private selectedId: string;
  private category: StyleCategory;
  private readonly tabs = new Map<StyleCategory, HTMLButtonElement>();
  private readonly list: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly items = new Map<string, HTMLButtonElement>();

  private equipment: Equipment;
  private slot: EquipmentSlot = 'rightArm';
  private readonly slotTabs = new Map<EquipmentSlot, HTMLButtonElement>();

  constructor(
    initialEquipment: Equipment,
    private readonly callbacks: StyleSelectCallbacks,
  ) {
    this.equipment = initialEquipment;
    this.selectedId = initialEquipment[this.slot];
    this.category = findAttackStyle(this.selectedId)?.category ?? 'sword';
    this.el = el('section', 'screen pause-screen style-screen');
    this.el.dataset.screen = 'styleSelect';
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    const dialog = el('div', 'dialog style-dialog');
    const head = el('div', 'dialog-head');
    const close = el('button', 'close-btn', 'X');
    close.dataset.testid = 'style-close';
    close.setAttribute('aria-label', '閉じる');
    onPress(close, () => this.callbacks.onClose());
    head.append(el('span', '', '装備'), close);

    // スロットタブ(頭 / 右腕 / 左腕)。S05 要素 6
    const slotTabs = el('div', 'slot-tabs');
    slotTabs.dataset.testid = 'slot-tabs';
    for (const s of EQUIPMENT_SLOTS) {
      const b = el('button', 'slot-tab', SLOT_LABELS[s]);
      b.dataset.testid = `slot-tab-${s}`;
      onPress(b, () => this.showSlot(s));
      this.slotTabs.set(s, b);
      slotTabs.append(b);
    }

    const tabs = el('div', 'style-tabs');
    tabs.dataset.testid = 'style-tabs';
    for (const c of CATEGORIES) {
      const b = el('button', 'style-tab', CATEGORY_LABELS[c]);
      b.dataset.testid = `style-category-${c}`;
      b.dataset.value = c;
      onPress(b, () => this.showCategory(c));
      this.tabs.set(c, b);
      tabs.append(b);
    }
    const body = el('div', 'dialog-body style-body');
    this.list = el('div', 'style-list');
    this.list.dataset.testid = 'style-list';
    this.detail = el('div', 'style-detail');
    this.detail.dataset.testid = 'style-detail';
    body.append(this.list, this.detail);

    const foot = el('div', 'dialog-foot');
    const done = el('button', 'btn primary', '決定');
    done.dataset.testid = 'style-done';
    onPress(done, () => this.callbacks.onClose());
    foot.append(done);
    dialog.append(head, slotTabs, tabs, body, foot);
    this.el.append(dialog);
    this.showCategory(this.category);
  }

  private showCategory(category: StyleCategory): void {
    this.category = category;
    for (const [c, b] of this.tabs) b.classList.toggle('on', c === category);
    this.list.replaceChildren();
    this.items.clear();
    for (const style of ATTACK_STYLES) {
      if (style.category !== category) continue;
      const b = el('button', 'style-item');
      b.dataset.testid = `style-item-${style.id}`;
      b.dataset.value = style.id;
      b.append(el('span', 'style-item-name', style.name));
      const tag = isStyleImplemented(style) ? `規模 ${style.scale}` : '未実装';
      b.append(el('span', 'style-item-tag', tag));
      onPress(b, () => this.select(style.id));
      this.items.set(style.id, b);
      this.list.append(b);
    }
    this.refreshSelection();
  }

  private select(id: string): void {
    if (this.selectedId !== id) {
      this.selectedId = id;
      this.equipment = withSlot(this.equipment, this.slot, id);
      this.callbacks.onSelect(this.slot, id);
    }
    this.refreshSelection();
  }

  /** スロットタブを切り替え、そのスロットの現在のスタイルを選択状態にする。 */
  showSlot(slot: EquipmentSlot): void {
    this.slot = slot;
    for (const [s, b] of this.slotTabs) b.classList.toggle('on', s === slot);
    this.setSelected(this.equipment[slot]);
  }

  currentSlot(): EquipmentSlot {
    return this.slot;
  }

  private refreshSelection(): void {
    for (const [id, b] of this.items) b.classList.toggle('on', id === this.selectedId);
    const style = findAttackStyle(this.selectedId);
    this.detail.replaceChildren();
    if (!style) return;
    this.detail.append(...this.detailRows(style));
  }

  private detailRows(style: AttackStyleDefinition): HTMLElement[] {
    const implemented = isStyleImplemented(style);
    const name = el('div', 'style-detail-name', style.name);
    name.dataset.testid = 'style-detail-name';
    const rows: HTMLElement[] = [
      name,
      el('div', 'style-detail-cat', `${CATEGORY_LABELS[style.category]} / 規模 ${style.scale}`),
      el('p', 'style-detail-desc', style.description),
      this.row('押下', `${actionLabel(style.press)}(コスト: ${costLabel(style.cost.press)})`),
      this.row(
        style.hold.trigger === 'release' ? '長押し → 離す' : '長押し',
        `${actionLabel(style.hold.action)}(コスト: ${costLabel(style.cost.hold)})`,
      ),
      this.row('機構', style.mechanisms.join(' ') || '-'),
    ];
    if (!implemented) {
      const note = el('div', 'style-detail-note', '未実装: 格闘の挙動になります');
      note.dataset.testid = 'style-unimplemented';
      rows.push(note);
    }
    return rows;
  }

  private row(label: string, value: string): HTMLElement {
    const r = el('div', 'style-detail-row');
    r.append(el('span', 'style-detail-label', label), el('span', 'style-detail-value', value));
    return r;
  }

  current(): string {
    return this.selectedId;
  }

  setSelected(id: string): void {
    this.selectedId = id;
    const category = findAttackStyle(id)?.category;
    if (category && category !== this.category) this.showCategory(category);
    else this.refreshSelection();
  }

  show(): void {
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }
}
