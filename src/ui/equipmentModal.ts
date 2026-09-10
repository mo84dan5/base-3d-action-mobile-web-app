import {
  CATEGORY_LABELS,
  type ActionSpec,
  type AttackStyleDefinition,
  type CostSpec,
  type StyleCategory,
} from '../domain/attackStyle/actionSpec';
import { ATTACK_STYLES, findAttackStyle } from '../domain/attackStyle/attackStyleCatalog';
import {
  ASSEMBLY_SLOTS,
  ASSEMBLY_SLOT_LABELS,
  withSlot,
  type AssemblySlot,
  type Equipment,
  type EquipmentSlot,
} from '../domain/equipment/equipment';
import {
  LOCOMOTION_TYPES,
  findLocomotion,
  type LocomotionType,
} from '../domain/locomotion/locomotion';
import { isStyleImplemented } from '../domain/attackStyle/styleResolver';
import { el, onPress } from './dom';

// S05 装備組み替えモーダル(全画面)。S03 の「装備を組み替える」から開き、
// スロットタブ(頭 / 右腕 / 左腕 / 脚)→ プレビュー + 系統タブ → 一覧 → 詳細 で選ぶ。
// 選択は即時に onSelect* で通知し、呼び出し側が保存・反映する。プレビューの描画は port 経由で注入する。

/** プレビュー(小窓)に渡す見た目の情報 */
export interface PreviewState {
  readonly categories: Readonly<Record<EquipmentSlot, StyleCategory>>;
  readonly locomotion: LocomotionType;
}

/** 小窓の 3D 描画(infrastructure)への口。ui 層は three.js に依存しない */
export interface EquipmentPreviewPort {
  setEquipment(state: PreviewState): void;
  /** 選んだスロットのデモモーションを再生する */
  play(slot: AssemblySlot): void;
  start(): void;
  stop(): void;
}

export interface EquipmentModalCallbacks {
  /** 頭 / 右腕 / 左腕に選んだスタイルを即時保存する(F12) */
  readonly onSelectStyle: (slot: EquipmentSlot, id: string) => void;
  /** 脚に選んだ移動タイプを即時保存する(F12 脚スロットと移動タイプ) */
  readonly onSelectLocomotion: (id: LocomotionType) => void;
  readonly onClose: () => void;
  /** 最初に開いたときに canvas を渡してプレビューを作る */
  readonly createPreview: (
    canvas: HTMLCanvasElement,
    initial: PreviewState,
  ) => EquipmentPreviewPort;
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

/** スロットタブに添える現在の装備名。未知のスタイル ID はそのまま出す */
export function slotValueLabel(
  slot: AssemblySlot,
  equipment: Equipment,
  locomotion: LocomotionType,
) {
  if (slot === 'legs') return findLocomotion(locomotion)?.name ?? locomotion;
  return findAttackStyle(equipment[slot])?.name ?? equipment[slot];
}

/** プレビューに渡す系統・移動タイプ。未知のスタイルは剣術扱い(付属物の既定) */
export function previewStateOf(equipment: Equipment, locomotion: LocomotionType): PreviewState {
  const category = (id: string): StyleCategory => findAttackStyle(id)?.category ?? 'sword';
  return {
    categories: {
      head: category(equipment.head),
      rightArm: category(equipment.rightArm),
      leftArm: category(equipment.leftArm),
    },
    locomotion,
  };
}

export class EquipmentModal {
  readonly el: HTMLElement;
  private equipment: Equipment;
  private locomotion: LocomotionType;
  private slot: AssemblySlot = 'rightArm';
  private category: StyleCategory = 'sword';
  private readonly slotTabs = new Map<AssemblySlot, HTMLButtonElement>();
  private readonly slotValues = new Map<AssemblySlot, HTMLElement>();
  private readonly categoryTabs = new Map<StyleCategory, HTMLButtonElement>();
  private readonly tabsRow: HTMLElement;
  private readonly list: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly items = new Map<string, HTMLButtonElement>();
  private readonly canvas: HTMLCanvasElement;
  private preview: EquipmentPreviewPort | null = null;

  constructor(
    initialEquipment: Equipment,
    initialLocomotion: LocomotionType,
    private readonly callbacks: EquipmentModalCallbacks,
  ) {
    this.equipment = initialEquipment;
    this.locomotion = initialLocomotion;
    this.el = el('section', 'screen equipment-screen');
    this.el.dataset.screen = 'equipment';
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());

    const head = el('div', 'dialog-head');
    const close = el('button', 'close-btn', 'X');
    close.dataset.testid = 'style-close';
    close.setAttribute('aria-label', '閉じる');
    onPress(close, () => this.callbacks.onClose());
    head.append(el('span', '', '装備'), close);

    // スロットタブ(頭 / 右腕 / 左腕 / 脚)。S05 要素 2
    const slotTabs = el('div', 'slot-tabs');
    slotTabs.dataset.testid = 'slot-tabs';
    for (const s of ASSEMBLY_SLOTS) {
      const b = el('button', 'slot-tab');
      b.dataset.testid = `slot-tab-${s}`;
      const value = el('span', 'slot-tab-value');
      this.slotValues.set(s, value);
      b.append(el('span', 'slot-tab-name', ASSEMBLY_SLOT_LABELS[s]), value);
      onPress(b, () => this.showSlot(s));
      this.slotTabs.set(s, b);
      slotTabs.append(b);
    }

    // プレビュー(小窓)。S05 要素 3
    const previewBox = el('div', 'equipment-preview');
    this.canvas = el('canvas', 'equipment-preview-canvas');
    this.canvas.dataset.testid = 'equipment-preview';
    previewBox.append(this.canvas);

    this.tabsRow = el('div', 'style-tabs');
    this.tabsRow.dataset.testid = 'style-tabs';
    for (const c of CATEGORIES) {
      const b = el('button', 'style-tab', CATEGORY_LABELS[c]);
      b.dataset.testid = `style-category-${c}`;
      b.dataset.value = c;
      onPress(b, () => this.showCategory(c));
      this.categoryTabs.set(c, b);
      this.tabsRow.append(b);
    }
    this.list = el('div', 'style-list');
    this.list.dataset.testid = 'style-list';
    this.detail = el('div', 'style-detail');
    this.detail.dataset.testid = 'style-detail';
    const columns = el('div', 'equipment-columns');
    columns.append(this.list, this.detail);
    const scroll = el('div', 'equipment-scroll');
    scroll.append(this.tabsRow, columns);
    const main = el('div', 'equipment-main');
    main.append(previewBox, scroll);

    const foot = el('div', 'dialog-foot');
    const done = el('button', 'btn primary', '決定');
    done.dataset.testid = 'style-done';
    onPress(done, () => this.callbacks.onClose());
    foot.append(done);
    this.el.append(head, slotTabs, main, foot);
    this.refreshSlotValues();
    this.showSlot(this.slot);
  }

  /** スロットタブを切り替え、そのスロットの現在の装備を選択状態にする(デモは再生しない)。 */
  showSlot(slot: AssemblySlot): void {
    this.slot = slot;
    for (const [s, b] of this.slotTabs) b.classList.toggle('on', s === slot);
    this.tabsRow.hidden = slot === 'legs';
    if (slot === 'legs') this.showLocomotionList();
    else this.showCategory(findAttackStyle(this.equipment[slot])?.category ?? 'sword');
  }

  currentSlot(): AssemblySlot {
    return this.slot;
  }

  private showCategory(category: StyleCategory): void {
    this.category = category;
    for (const [c, b] of this.categoryTabs) b.classList.toggle('on', c === category);
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
      onPress(b, () => this.selectStyle(style.id));
      this.items.set(style.id, b);
      this.list.append(b);
    }
    this.refreshSelection();
  }

  private showLocomotionList(): void {
    this.list.replaceChildren();
    this.items.clear();
    for (const type of LOCOMOTION_TYPES) {
      const b = el('button', 'style-item');
      b.dataset.testid = `locomotion-item-${type.id}`;
      b.dataset.value = type.id;
      b.append(el('span', 'style-item-name', type.name));
      if (!type.implemented) b.append(el('span', 'style-item-tag', '未実装'));
      onPress(b, () => this.selectLocomotion(type.id));
      this.items.set(type.id, b);
      this.list.append(b);
    }
    this.refreshSelection();
  }

  private selectStyle(id: string): void {
    if (this.slot === 'legs') return;
    const slot: EquipmentSlot = this.slot;
    if (this.equipment[slot] !== id) {
      this.equipment = withSlot(this.equipment, slot, id);
      this.callbacks.onSelectStyle(slot, id);
    }
    this.afterSelect();
  }

  private selectLocomotion(id: LocomotionType): void {
    if (this.locomotion !== id) {
      this.locomotion = id;
      this.callbacks.onSelectLocomotion(id);
    }
    this.afterSelect();
  }

  /** 選んだ瞬間に付属物・脚を差し替え、そのスロットのデモを 1 回再生する(S05 要素 3) */
  private afterSelect(): void {
    this.refreshSlotValues();
    this.refreshSelection();
    this.preview?.setEquipment(previewStateOf(this.equipment, this.locomotion));
    this.preview?.play(this.slot);
  }

  private selectedId(): string {
    return this.slot === 'legs' ? this.locomotion : this.equipment[this.slot];
  }

  private refreshSlotValues(): void {
    for (const [s, v] of this.slotValues) {
      v.textContent = slotValueLabel(s, this.equipment, this.locomotion);
    }
  }

  private refreshSelection(): void {
    const selected = this.selectedId();
    for (const [id, b] of this.items) b.classList.toggle('on', id === selected);
    this.detail.replaceChildren();
    if (this.slot === 'legs') {
      const type = findLocomotion(selected);
      if (type) this.detail.append(...this.locomotionRows(type));
      return;
    }
    const style = findAttackStyle(selected);
    if (style) this.detail.append(...this.styleRows(style));
  }

  private styleRows(style: AttackStyleDefinition): HTMLElement[] {
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

  private locomotionRows(type: (typeof LOCOMOTION_TYPES)[number]): HTMLElement[] {
    const name = el('div', 'style-detail-name', type.name);
    name.dataset.testid = 'style-detail-name';
    const rows: HTMLElement[] = [
      name,
      el('div', 'style-detail-cat', '移動タイプ'),
      el('p', 'style-detail-desc', type.description),
    ];
    if (!type.implemented) {
      const note = el('div', 'style-detail-note', '未実装: 二足の見た目・挙動になります');
      note.dataset.testid = 'locomotion-unimplemented';
      rows.push(note);
    }
    return rows;
  }

  private row(label: string, value: string): HTMLElement {
    const r = el('div', 'style-detail-row');
    r.append(el('span', 'style-detail-label', label), el('span', 'style-detail-value', value));
    return r;
  }

  show(): void {
    this.el.hidden = false;
    // 最初に開いたときに WebGL のプレビューを作る(canvas が表示されて寸法を持ってから)
    this.preview ??= this.callbacks.createPreview(
      this.canvas,
      previewStateOf(this.equipment, this.locomotion),
    );
    this.preview.start();
  }

  hide(): void {
    this.el.hidden = true;
    this.preview?.stop();
  }
}
