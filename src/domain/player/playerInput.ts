import type { EquipmentSlot } from '../equipment/equipment';
import type { AttackStyleDefinition, TargetCone } from '../attackStyle/actionSpec';
import { defaultAttackStyle } from '../attackStyle/attackStyleCatalog';
import type { ConeTarget } from '../combat/hitGeometry';
import type { StickInput } from '../stick/virtualStick';

// プレイヤー状態機械への 1 ステップぶんの入力(F03 / F04 / F11)。

export interface PlayerStepInput {
  readonly stick: StickInput;
  readonly cameraYaw: number;
  readonly jump: boolean;
  readonly dash: boolean;
  readonly attack: boolean;
  readonly burst: boolean;
  readonly sprintHoldStart: boolean;
  readonly sprintHoldEnd: boolean;
  readonly attackHoldStart: boolean;
  readonly attackHoldEnd: boolean;
  /** 開始カウントダウン中は false(攻撃・スキル・バースト無効) */
  readonly actionsAllowed: boolean;
  /** 今ステップの技の入力(attack / attackHoldStart / attackHoldEnd)が属するスロット(F12) */
  readonly slot: EquipmentSlot;
  /** そのスロットの攻撃スタイル定義(F11。application が設定 ID から解決する) */
  readonly style: AttackStyleDefinition;
  /** 現在のエネルギー(F03。コストの判定に使う) */
  readonly energy: number;
  /** 0〜1 の乱数(ランダムスタイル用) */
  readonly random: number;
  /** ターゲット補正: 正面の円錐内で最も近い敵(application が敵の位置から求める) */
  readonly findTarget: (cone: TargetCone) => ConeTarget | null;
  /** 複数ロック用: 円錐内の近い順に最大 max 体 */
  readonly findTargets: (cone: TargetCone, max: number) => readonly ConeTarget[];
  /** 正面 distance m 以内に壁(登攀可否を問わない)があるか。壁蹴り撃の条件 */
  readonly wallAhead: (distance: number) => boolean;
}

export const NO_INPUT: PlayerStepInput = {
  stick: { x: 0, y: 0, magnitude: 0 },
  cameraYaw: 0,
  jump: false,
  dash: false,
  attack: false,
  burst: false,
  sprintHoldStart: false,
  sprintHoldEnd: false,
  attackHoldStart: false,
  attackHoldEnd: false,
  actionsAllowed: true,
  slot: 'rightArm',
  style: defaultAttackStyle(),
  energy: 0,
  random: 0,
  findTarget: () => null,
  findTargets: () => [],
  wallAhead: () => false,
};
