import type { AttackKind } from '../hitReaction/hitTables';

// 攻撃スタイルの定義(F11 攻撃スタイルカタログ / F04 スタイル定義スキーマ)。
// 押下・長押しの挙動を「アクション仕様」のデータで表し、機構ごとの汎用エンジンが実行する。

export type HitClass = 'light' | 'medium' | 'heavy' | 'huge';

export type MechanismCode =
  | 'A1'
  | 'A2'
  | 'A3'
  | 'A4'
  | 'A5'
  | 'A6'
  | 'A7'
  | 'N1'
  | 'N2'
  | 'N3'
  | 'N4'
  | 'N5'
  | 'N6'
  | 'N7'
  | 'N8'
  | 'N9'
  | 'N10';

export type StyleCategory =
  | 'sword'
  | 'strike'
  | 'polearm'
  | 'firearm'
  | 'ranged'
  | 'magic'
  | 'placement'
  | 'defense'
  | 'movement'
  | 'special';

export const CATEGORY_LABELS: Readonly<Record<StyleCategory, string>> = {
  sword: '剣術',
  strike: '打撃',
  polearm: '長柄',
  firearm: '銃火器',
  ranged: '弓・投擲',
  magic: '魔法風',
  placement: '設置・召喚',
  defense: '防御・カウンター',
  movement: '移動連動',
  special: '特殊',
};

export type CostSpec =
  | { readonly type: 'none' }
  | { readonly type: 'stamina'; readonly amount: number }
  | { readonly type: 'energy'; readonly amount: number }
  | { readonly type: 'staminaPerSecond'; readonly rate: number }
  | { readonly type: 'energyPerSecond'; readonly rate: number }
  | { readonly type: 'allStamina' }
  | { readonly type: 'hp'; readonly amount: number };

/** 当たり判定の形。正面方向を基準にする */
export type HitShape =
  | { readonly type: 'sphere'; readonly radius: number; readonly forward: number }
  | { readonly type: 'fan'; readonly radius: number; readonly angleDeg: number }
  | { readonly type: 'ring'; readonly radius: number; readonly width: number }
  | { readonly type: 'line'; readonly length: number; readonly width: number };

export interface TargetCone {
  readonly halfAngleDeg: number;
  readonly range: number;
}

export interface ComboStageSpec {
  readonly damage: number;
  readonly startup: number;
  readonly active: number;
  readonly total: number;
  readonly advance: number;
}

export interface ComboSpec {
  readonly kind: 'combo';
  readonly stages: readonly ComboStageSpec[];
  readonly shape: HitShape;
  readonly comboWindow: number;
  readonly hitClass: HitClass;
  readonly knockback: number;
  readonly energyPerHit: number;
  readonly target: TargetCone | null;
  /** 攻撃中も移動を止めない(蹴りなど) */
  readonly keepMoving: boolean;
  /** 空中で使える回数(0 = 空中不可、Infinity = 無制限) */
  readonly airUses: number;
  readonly heal?: number;
  /** F10 の表を段ごとに指定する(格闘の正典 normal1〜3)。無ければ hitClass の表 */
  readonly kinds?: readonly AttackKind[];
}

export interface LungeSpec {
  readonly kind: 'lunge';
  readonly damage: number;
  readonly startup: number;
  readonly active: number;
  readonly total: number;
  readonly shape: HitShape;
  readonly lungeSpeed: number;
  readonly lungeMaxTime: number;
  readonly stopDistance: number;
  readonly target: TargetCone | null;
  readonly knockback: number;
  readonly hitClass: HitClass;
  readonly energyPerHit: number;
  /** 突進中に通過した敵にヒットさせる(踏み込み後の振りは無し) */
  readonly hitWhileMoving: boolean;
  readonly stunSeconds?: number;
  readonly attackKind?: AttackKind;
}

export interface HitscanSpec {
  readonly kind: 'hitscan';
  readonly damage: number;
  readonly range: number;
  readonly startup: number;
  readonly total: number;
  readonly rays: number;
  readonly spreadDeg: number;
  readonly pierce: boolean;
  readonly target: TargetCone | null;
  readonly knockback: number;
  readonly hitClass: HitClass;
  readonly energyPerHit: number;
  readonly airborne: boolean;
  readonly beamWidth: number;
  readonly ammo?: { readonly capacity: number; readonly reloadTime: number };
  readonly burst?: { readonly count: number; readonly interval: number };
  readonly dot?: { readonly perSecond: number; readonly duration: number };
  /** 同時に 2 体をロックする(二丁拳銃) */
  readonly multiTarget?: number;
  readonly attackKind?: AttackKind;
  /** スタミナ残量 × 係数をダメージにする(スタミナ弾の長押し) */
  readonly damagePerStamina?: number;
}

export interface ChargeScale {
  readonly damage?: readonly [number, number];
  readonly radius?: readonly [number, number];
  readonly range?: readonly [number, number];
  readonly distance?: readonly [number, number];
}

export interface ChargeSpec {
  readonly kind: 'charge';
  readonly maxTime: number;
  readonly moveSpeed: number;
  readonly release: ActionSpec;
  readonly scale: ChargeScale;
  /** タメ中のカメラ距離(スナイパー) */
  readonly cameraDistance?: number;
  /** 段階(超タメ)。秒 → ダメージ */
  readonly tiers?: readonly { readonly seconds: number; readonly damage: number }[];
}

export interface AreaSpec {
  readonly kind: 'area';
  readonly damage: number;
  readonly shape: HitShape;
  readonly startup: number;
  readonly active: number;
  readonly total: number;
  readonly knockback: number;
  readonly hitClass: HitClass;
  readonly energyPerHit: number;
  readonly movement: 'stop' | 'walk' | 'run';
  /** ジャンプして着地点で発動(地割り・急降下) */
  readonly jumpHeight?: number;
  /** リングが最大半径まで広がる秒(衝撃波) */
  readonly expandSeconds?: number;
  readonly stunSeconds?: number;
  readonly selfDamage?: number;
  readonly airborneOnly?: boolean;
  readonly attackKind?: AttackKind;
}

export interface MultihitSpec {
  readonly kind: 'multihit';
  readonly damage: number;
  readonly interval: number;
  readonly count: number;
  readonly shape: HitShape;
  readonly moveSpeed: number;
  readonly hitClass: HitClass;
  readonly knockback: number;
  readonly energyPerHit: number;
  /** 長押しの間だけ続ける(離すと終了) */
  readonly whileHeld: boolean;
  readonly maxDuration: number;
  /** 連射間隔が時間とともに縮む(ガトリング) */
  readonly accelerateTo?: number;
  readonly ranged?: {
    readonly range: number;
    readonly pierce: boolean;
    readonly beamWidth: number;
  };
}

export interface ProjectileSpec {
  readonly kind: 'projectile';
  readonly damage: number;
  readonly speed: number;
  readonly range: number;
  readonly count: number;
  readonly spreadDeg: number;
  readonly interval: number;
  readonly gravity: boolean;
  readonly homing: boolean;
  readonly returning: boolean;
  readonly bounces: number;
  readonly pierce: boolean;
  readonly radius: number;
  readonly explosion?: { readonly radius: number; readonly damage: number };
  readonly hitClass: HitClass;
  readonly knockback: number;
  readonly energyPerHit: number;
  readonly target: TargetCone | null;
  readonly startup: number;
  readonly total: number;
  readonly orbit?: { readonly radius: number; readonly turns: number };
  readonly dot?: { readonly perSecond: number; readonly duration: number };
  readonly airborne: boolean;
}

export type PlacedObjectKind =
  'mine' | 'turret' | 'stake' | 'field' | 'wall' | 'decoy' | 'barrel' | 'meteor' | 'gravity';

export interface PlacedSpec {
  readonly kind: 'placed';
  readonly object: PlacedObjectKind;
  readonly lifetime: number;
  readonly radius: number;
  readonly damage: number;
  readonly interval: number;
  readonly delay: number;
  readonly maxCount: number;
  readonly forward: number;
  readonly hitClass: HitClass;
  readonly knockback: number;
  readonly energyPerHit: number;
  readonly count: number;
  readonly spreadDeg: number;
  readonly pullSpeed?: number;
  readonly rollSpeed?: number;
  readonly blocksEnemies?: boolean;
  /** 押下で置き、長押しで全起爆 / 強化 / 押し出し */
  readonly command?: 'detonateAll' | 'boost' | 'push';
}

export type SummonKind = 'familiar' | 'drone' | 'swords' | 'mirage' | 'turret';

export interface SummonSpec {
  readonly kind: 'summon';
  readonly entity: SummonKind;
  readonly count: number;
  readonly lifetime: number;
  readonly damage: number;
  readonly interval: number;
  readonly range: number;
  readonly hitClass: HitClass;
  readonly energyPerHit: number;
  readonly command?: 'charge' | 'launchAll' | 'boost';
  readonly commandDamage?: number;
  readonly commandRadius?: number;
}

export interface GuardSpec {
  readonly kind: 'guard';
  readonly window: number;
  readonly angleDeg: number;
  readonly reduction: number;
  readonly onSuccess: 'counter' | 'topple' | 'reflect' | 'none';
  readonly counterDamage: number;
  readonly toppleSeconds: number;
  readonly failRecovery: number;
  readonly staminaPerSecond: number;
  /** 離したときの追撃(盾突進など) */
  readonly release?: ActionSpec;
  readonly moveSpeed: number;
  /** 被弾時に自動反撃(反撃姿勢) */
  readonly autoRiposte: boolean;
}

export type MovementKind =
  | 'dodge'
  | 'dive'
  | 'slide'
  | 'skate'
  | 'jump'
  | 'wallKick'
  | 'dashSlash'
  | 'sprintRam'
  | 'blink'
  | 'poleVault'
  | 'airCombo'
  | 'glideShot'
  | 'wallJump';

export type MovementRequirement =
  'any' | 'dash' | 'airborne' | 'sprint' | 'climb' | 'glide' | 'wallNear';

export interface MovementSpec {
  readonly kind: 'movement';
  readonly move: MovementKind;
  readonly requires: MovementRequirement;
  readonly distance: number;
  readonly speed: number;
  readonly height: number;
  readonly invincible: number;
  readonly then: ActionSpec | null;
  /** 派生に使える猶予(ダッシュ後 0.3 秒など) */
  readonly windowSeconds: number;
  readonly staminaPerSecond?: number;
  readonly fallSpeed?: number;
}

export type BuffKind =
  'damageUp' | 'damageReduction' | 'taunt' | 'timeStop' | 'momentum' | 'rhythm';

export interface BuffSpec {
  readonly kind: 'buff';
  readonly effect: BuffKind;
  readonly amount: number;
  readonly duration: number;
  readonly radius: number;
  readonly then: ActionSpec | null;
  readonly maxStacks?: number;
  readonly beatSeconds?: number;
}

export interface SelfEffectSpec {
  readonly kind: 'selfEffect';
  readonly hpDelta: number;
  readonly minHp: number;
  readonly then: ActionSpec;
}

export interface PullSpec {
  readonly kind: 'pull';
  readonly radius: number;
  readonly speed: number;
  readonly stopDistance: number;
  readonly holdSeconds: number;
  readonly then: ActionSpec | null;
  readonly reach: number;
  readonly damage: number;
  readonly hitClass: HitClass;
  readonly energyPerHit: number;
}

export interface RandomSpec {
  readonly kind: 'random';
  readonly pool: readonly string[];
}

export interface NoneSpec {
  readonly kind: 'none';
}

export type ActionSpec =
  | ComboSpec
  | LungeSpec
  | HitscanSpec
  | ChargeSpec
  | AreaSpec
  | MultihitSpec
  | ProjectileSpec
  | PlacedSpec
  | SummonSpec
  | GuardSpec
  | MovementSpec
  | BuffSpec
  | SelfEffectSpec
  | PullSpec
  | RandomSpec
  | NoneSpec;

export type ActionKind = ActionSpec['kind'];

export interface HoldSpec {
  /** start: 長押し開始で発動 / release: 離した瞬間に発動(タメ) */
  readonly trigger: 'start' | 'release';
  readonly action: ActionSpec;
}

export type StyleScale = 'S' | 'M' | 'L';

export interface AttackStyleDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: StyleCategory;
  readonly description: string;
  readonly press: ActionSpec;
  readonly hold: HoldSpec;
  readonly cost: { readonly press: CostSpec; readonly hold: CostSpec };
  readonly mechanisms: readonly MechanismCode[];
  readonly scale: StyleScale;
}

/** アクション仕様に含まれる全種別(入れ子を含む)。 */
export function actionKinds(spec: ActionSpec | null): ActionKind[] {
  if (!spec) return [];
  const kinds: ActionKind[] = [spec.kind];
  switch (spec.kind) {
    case 'charge':
      kinds.push(...actionKinds(spec.release));
      break;
    case 'guard':
      kinds.push(...actionKinds(spec.release ?? null));
      break;
    case 'movement':
    case 'buff':
    case 'pull':
      kinds.push(...actionKinds(spec.then));
      break;
    case 'selfEffect':
      kinds.push(...actionKinds(spec.then));
      break;
    default:
      break;
  }
  return kinds;
}

export function styleActionKinds(style: AttackStyleDefinition): ActionKind[] {
  return [...actionKinds(style.press), ...actionKinds(style.hold.action)];
}
