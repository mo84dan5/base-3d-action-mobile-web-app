// 「調整可 ○」のパラメータを 1 か所に集約する(機能仕様書 共通方針)。
// 数値はすべて仕様書の初期値。単位: 距離 m、時間 秒(ステップ数と明記したものを除く)、角度 度。

export const FIXED_STEP_SECONDS = 1 / 60;
export const MAX_SUBSTEPS_PER_FRAME = 4;

export const degToRad = (deg: number): number => (deg * Math.PI) / 180;

export interface StickConfig {
  /** 外円半径(CSS px) */
  readonly outerRadiusPx: number;
  /** デッドゾーン(外円半径に対する比) */
  readonly deadZoneRatio: number;
  /** 固定モードで操作を開始できる範囲(外円半径に対する倍率) */
  readonly fixedStartRangeRatio: number;
  /** 歩き / 走りの閾値(大きさ) */
  readonly runThreshold: number;
  /** 指を離したときのフェードアウト秒 */
  readonly fadeOutSeconds: number;
  /** 固定モードの位置(表示領域に対する比) */
  readonly fixedPosition: {
    readonly landscape: { readonly x: number; readonly y: number };
    readonly portrait: { readonly x: number; readonly y: number };
  };
}

export interface MovementConfig {
  readonly walkSpeed: number;
  readonly runSpeed: number;
  readonly sprintSpeed: number;
  readonly dashSpeed: number;
  readonly dashDuration: number;
  /** 速度補間の加速度(m/s²) */
  readonly acceleration: number;
  /** 空中での水平加速度(地上比) */
  readonly airControlRatio: number;
  /** 向きの回転速度(度/秒) */
  readonly turnSpeedDeg: number;
  readonly jumpSpeed: number;
  readonly coyoteTime: number;
  readonly jumpBufferTime: number;
  /** 長押し判定(秒)。F03 の 200 ms と同じ値 */
  readonly sprintHoldThreshold: number;
}

export interface StaminaConfig {
  readonly max: number;
  readonly regenPerSecond: number;
  readonly regenDelay: number;
  readonly dashCost: number;
  readonly sprintCostPerSecond: number;
  readonly climbCostPerSecond: number;
  readonly cliffJumpCost: number;
  readonly glideCostPerSecond: number;
  /** 赤く点滅する残量比 */
  readonly lowRatio: number;
}

export interface CameraConfig {
  readonly targetOffsetY: number;
  readonly climbTargetOffsetY: number;
  readonly defaultDistance: number;
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly defaultPitchDeg: number;
  readonly minPitchDeg: number;
  readonly climbMinPitchDeg: number;
  readonly maxPitchDeg: number;
  readonly fovDeg: { readonly landscape: number; readonly portrait: number };
  /** 注視点のスクリーン上の高さ(上から。0〜1) */
  readonly targetScreenHeight: { readonly landscape: number; readonly portrait: number };
  /** 感度 1.0 のときの 1 CSS px あたりの角度(度) */
  readonly degreesPerPx: number;
  /** ピンチ: 指間距離 pinchPxPerMeter px の変化で 1 m */
  readonly pinchPxPerMeter: number;
  /** ホイール 1 ノッチあたりの距離変化(m) */
  readonly wheelMetersPerNotch: number;
  /** 注視点追従の時定数(秒) */
  readonly followTimeConstant: number;
  /** ドラッグ終了後の慣性減衰時間(秒) */
  readonly inertiaDecay: number;
  /** 障害物の手前に置く距離(m) */
  readonly obstacleMargin: number;
  /** 障害物からの復帰補間(秒) */
  readonly obstacleRecoverTime: number;
  /** プレイヤーを非表示にする距離(m) */
  readonly hidePlayerDistance: number;
  /** 滑空中の距離加算(m) */
  readonly glideDistanceBonus: number;
  /** 崖登り・滑空の出入りの補間(秒) */
  readonly stateTransitionTime: number;
}

export interface ActionConfig {
  /** 押下 / 長押しの境界(秒) */
  readonly holdThreshold: number;
  /** 条件付きで出現するボタンの出現直後ロック(秒) */
  readonly appearLockTime: number;
  readonly skillCooldown: number;
  readonly burstCooldown: number;
  readonly energyMax: number;
  readonly energyPerNormalHit: number;
  readonly energyPerSkillHit: number;
  readonly energyPerStrongAttackHit: number;
  readonly energyPerShootHit: number;
  readonly energyPerChargedShotHit: number;
  readonly buttonPressVibrationMs: number;
  readonly playerHitVibrationMs: number;
  /** 看板のインタラクト範囲(m) */
  readonly signboardRange: number;
  /** インタラクトのメッセージ表示秒 */
  readonly interactMessageSeconds: number;
}

export interface AttackTiming {
  readonly damage: number;
  readonly startup: number;
  readonly active: number;
  readonly total: number;
}

export interface NormalAttackStage extends AttackTiming {
  readonly advance: number;
}

export interface CombatConfig {
  readonly playerMaxHp: number;
  readonly playerHitStun: number;
  readonly playerInvincibleTime: number;
  readonly playerKnockbackSpeed: number;
  readonly knockbackDecayTime: number;
  readonly normalAttack: readonly [NormalAttackStage, NormalAttackStage, NormalAttackStage];
  /** 当たり判定球: 正面 hitSphereForward m・半径 hitSphereRadius m */
  readonly hitSphereForward: number;
  readonly hitSphereRadius: number;
  /** 次段の受付猶予(全体時間の終了後、秒) */
  readonly comboWindow: number;
  /** ターゲット補正: 半角(度)と距離(m) */
  readonly targetCorrectionHalfAngleDeg: number;
  readonly targetCorrectionRange: number;
  readonly airAttack: AttackTiming;
  readonly skill: AttackTiming & { readonly radius: number; readonly knockbackSpeed: number };
  readonly burst: AttackTiming & { readonly radius: number };
  readonly normalAttackKnockbackSpeed: number;
  /** 接近強攻撃(格闘、長押し。F04) */
  readonly strongAttack: AttackTiming & {
    readonly staminaCost: number;
    readonly targetHalfAngleDeg: number;
    readonly targetRange: number;
    readonly lungeSpeed: number;
    readonly lungeMaxTime: number;
    readonly lungeStopDistance: number;
    readonly radius: number;
    readonly knockbackSpeed: number;
  };
  /** 射撃(銃撃、押下。F04) */
  readonly shoot: AttackTiming & {
    readonly range: number;
    readonly targetHalfAngleDeg: number;
    readonly knockbackSpeed: number;
  };
  /** タメ打ち(銃撃、長押し。F04) */
  readonly chargedShot: AttackTiming & {
    readonly maxChargeTime: number;
    readonly baseDamage: number;
    readonly bonusDamage: number;
    readonly range: number;
    readonly knockbackSpeed: number;
    /** タメ中の移動速度上限(m/s) */
    readonly chargeMoveSpeed: number;
  };
  /** 開始カウントダウン: 3, 2, 1 各 1 秒 + START 0.5 秒 */
  readonly countdownSeconds: number;
  readonly countdownStartLabelSeconds: number;
  /** 結果成立から S04 表示までの秒 */
  readonly resultDelay: number;
}

export interface EnemyConfig {
  readonly capsuleRadius: number;
  readonly capsuleHeight: number;
  readonly dummyHp: number;
  readonly patrolHp: number;
  readonly moveSpeed: number;
  readonly attackDamage: number;
  readonly attack: AttackTiming;
  readonly attackCooldown: number;
  readonly attackForward: number;
  readonly attackRadius: number;
  readonly hitStun: number;
  /** 硬直を適用する最小間隔(秒) */
  readonly hitStunInterval: number;
  readonly chaseStartDistance: number;
  readonly chaseStopDistance: number;
  readonly attackDistance: number;
  readonly attackMaxHeightDiff: number;
  readonly deathHoldTime: number;
  readonly deathCollapseTime: number;
  /** 敵 HP バーの表示秒 */
  readonly hpBarVisibleSeconds: number;
}

export interface PhysicsConfig {
  readonly playerCapsuleRadius: number;
  readonly playerCapsuleHeight: number;
  readonly gravity: number;
  readonly terminalVelocity: number;
  readonly groundCastDistance: number;
  readonly walkableMaxSlopeDeg: number;
  readonly wallMinSlopeDeg: number;
  /** 天井の法線 y 閾値(未満で天井) */
  readonly ceilingNormalY: number;
  readonly stepOffset: number;
  /** ステージ外への座標クランプ(±m) */
  readonly worldBound: number;
  /** 分離処理の移動比率 */
  readonly separationRatio: number;
}

export interface ClimbConfig {
  readonly attachReach: number;
  readonly attachAnimTime: number;
  readonly attachDistanceFromWall: number;
  readonly upSpeed: number;
  readonly downSpeed: number;
  readonly sideSpeed: number;
  readonly cliffJumpSpeed: number;
  readonly cliffJumpDuration: number;
  readonly detachSpeed: number;
  readonly staminaOutDetachSpeed: number;
  readonly hitDetachSpeed: number;
  readonly mantleTime: number;
  /** 頂上判定: 頭上キャストの高さ(足元から)と正面距離 */
  readonly topCheckHeight: number;
  readonly topCheckForward: number;
  readonly topCheckInset: number;
  readonly topCheckDownDistance: number;
  /** 面の再取得キャストの正面距離 */
  readonly wallReacquireDistance: number;
  /** 取り付き判定の高さ(カプセル中心と頭上) */
  readonly attachCheckHeights: readonly [number, number];
}

export interface GlideConfig {
  readonly minAltitude: number;
  readonly descentSpeed: number;
  readonly descentBlendTime: number;
  readonly maxHorizontalSpeed: number;
  readonly horizontalAcceleration: number;
  readonly horizontalDecelTime: number;
  readonly turnSpeedDeg: number;
}

export interface HitstopSteps {
  readonly attacker: number;
  readonly victim: number;
}

export interface ShakeSpec {
  readonly amplitude: number;
  readonly steps: number;
}

export interface HitReactionConfig {
  readonly hitstop: {
    readonly normal12: HitstopSteps;
    readonly normal3: HitstopSteps;
    readonly airAttack: HitstopSteps;
    readonly skill: HitstopSteps;
    readonly burst: HitstopSteps;
    readonly enemyAttack: HitstopSteps;
    readonly strongAttack: HitstopSteps;
    readonly shoot: HitstopSteps;
    /** タメ 0.5 秒未満 */
    readonly chargedShotWeak: HitstopSteps;
    /** タメ 0.5 秒以上 */
    readonly chargedShotStrong: HitstopSteps;
  };
  /** 1 回の攻撃で攻撃側に掛かる合計の上限(ステップ) */
  readonly attackerHitstopCapSteps: number;
  readonly flashSteps: number;
  readonly shake: {
    readonly normal3: ShakeSpec;
    readonly airAttack: ShakeSpec;
    readonly skill: ShakeSpec;
    readonly burst: ShakeSpec;
    readonly playerHit: ShakeSpec;
    readonly enemyDefeat: ShakeSpec;
    readonly playerDefeat: ShakeSpec;
    readonly landing: ShakeSpec;
    readonly strongAttack: ShakeSpec;
    /** タメ打ち発射: 振幅 base + bonus × タメ率、持続 steps(最大タメで maxSteps) */
    readonly chargedShot: {
      readonly base: number;
      readonly bonus: number;
      readonly steps: number;
      readonly maxSteps: number;
    };
  };
  readonly shakeMaxAmplitude: number;
  readonly shakeMaxSteps: number;
  readonly shakeFrequencyHz: number;
  /** 着地シェイクを出す落下速度(m/s) */
  readonly heavyLandingSpeed: number;
  readonly damageNumberLifetime: number;
  readonly damageNumberRise: number;
  readonly damageNumberStackOffset: number;
  readonly damageNumberMaxStack: number;
  readonly bigDamageThreshold: number;
  readonly playerDefeatAnimTime: number;
}

export interface GameConfig {
  readonly stick: StickConfig;
  readonly movement: MovementConfig;
  readonly stamina: StaminaConfig;
  readonly camera: CameraConfig;
  readonly action: ActionConfig;
  readonly combat: CombatConfig;
  readonly enemy: EnemyConfig;
  readonly physics: PhysicsConfig;
  readonly climb: ClimbConfig;
  readonly glide: GlideConfig;
  readonly hitReaction: HitReactionConfig;
}

export const defaultConfig: GameConfig = {
  stick: {
    outerRadiusPx: 60,
    deadZoneRatio: 0.15,
    fixedStartRangeRatio: 1.5,
    runThreshold: 0.6,
    fadeOutSeconds: 0.1,
    fixedPosition: { landscape: { x: 0.25, y: 0.7 }, portrait: { x: 0.25, y: 0.8 } },
  },
  movement: {
    walkSpeed: 1.8,
    runSpeed: 4.5,
    sprintSpeed: 6.5,
    dashSpeed: 9.0,
    dashDuration: 0.25,
    acceleration: 30,
    airControlRatio: 0.3,
    turnSpeedDeg: 720,
    jumpSpeed: 7.0,
    coyoteTime: 0.1,
    jumpBufferTime: 0.1,
    sprintHoldThreshold: 0.2,
  },
  stamina: {
    max: 100,
    regenPerSecond: 25,
    regenDelay: 1.0,
    dashCost: 18,
    sprintCostPerSecond: 15,
    climbCostPerSecond: 8,
    cliffJumpCost: 15,
    glideCostPerSecond: 6,
    lowRatio: 0.2,
  },
  camera: {
    targetOffsetY: 1.4,
    climbTargetOffsetY: 1.0,
    defaultDistance: 4.5,
    minDistance: 2.0,
    maxDistance: 8.0,
    defaultPitchDeg: 15,
    minPitchDeg: -30,
    climbMinPitchDeg: -50,
    maxPitchDeg: 70,
    fovDeg: { landscape: 50, portrait: 70 },
    targetScreenHeight: { landscape: 0.5, portrait: 0.35 },
    degreesPerPx: 0.25,
    pinchPxPerMeter: 100,
    wheelMetersPerNotch: 0.5,
    followTimeConstant: 0.08,
    inertiaDecay: 0.15,
    obstacleMargin: 0.2,
    obstacleRecoverTime: 0.3,
    hidePlayerDistance: 1.0,
    glideDistanceBonus: 1.0,
    stateTransitionTime: 0.3,
  },
  action: {
    holdThreshold: 0.2,
    appearLockTime: 0.15,
    skillCooldown: 8.0,
    burstCooldown: 5.0,
    energyMax: 100,
    energyPerNormalHit: 5,
    energyPerSkillHit: 15,
    energyPerStrongAttackHit: 10,
    energyPerShootHit: 3,
    energyPerChargedShotHit: 10,
    buttonPressVibrationMs: 10,
    playerHitVibrationMs: 20,
    signboardRange: 2.0,
    interactMessageSeconds: 2.0,
  },
  combat: {
    playerMaxHp: 100,
    playerHitStun: 0.3,
    playerInvincibleTime: 0.5,
    playerKnockbackSpeed: 1.7,
    knockbackDecayTime: 0.3,
    normalAttack: [
      { damage: 10, startup: 0.1, active: 0.1, total: 0.4, advance: 0.3 },
      { damage: 10, startup: 0.1, active: 0.1, total: 0.4, advance: 0.3 },
      { damage: 15, startup: 0.15, active: 0.15, total: 0.6, advance: 0.5 },
    ],
    hitSphereForward: 1.0,
    hitSphereRadius: 1.2,
    comboWindow: 0.8,
    targetCorrectionHalfAngleDeg: 30,
    targetCorrectionRange: 3.0,
    airAttack: { damage: 10, startup: 0.1, active: 0.1, total: 0.4 },
    skill: { damage: 30, startup: 0.2, active: 0.1, total: 0.7, radius: 2.5, knockbackSpeed: 5.0 },
    burst: { damage: 80, startup: 0.3, active: 0.2, total: 1.2, radius: 4.0 },
    normalAttackKnockbackSpeed: 1.7,
    strongAttack: {
      damage: 35,
      startup: 0.1,
      active: 0.15,
      total: 0.7,
      staminaCost: 25,
      targetHalfAngleDeg: 45,
      targetRange: 6.0,
      lungeSpeed: 9.0,
      lungeMaxTime: 0.35,
      lungeStopDistance: 1.0,
      radius: 1.5,
      knockbackSpeed: 5.0,
    },
    shoot: {
      damage: 8,
      startup: 0.05,
      active: 0,
      total: 0.25,
      range: 12.0,
      targetHalfAngleDeg: 15,
      knockbackSpeed: 1.0,
    },
    chargedShot: {
      damage: 20,
      startup: 0.05,
      active: 0,
      total: 0.5,
      maxChargeTime: 1.0,
      baseDamage: 20,
      bonusDamage: 40,
      range: 16.0,
      knockbackSpeed: 3.0,
      chargeMoveSpeed: 1.8,
    },
    countdownSeconds: 3,
    countdownStartLabelSeconds: 0.5,
    resultDelay: 1.5,
  },
  enemy: {
    capsuleRadius: 0.5,
    capsuleHeight: 1.8,
    dummyHp: 200,
    patrolHp: 60,
    moveSpeed: 2.0,
    attackDamage: 15,
    attack: { damage: 15, startup: 0.6, active: 0.15, total: 1.5 },
    attackCooldown: 2.0,
    attackForward: 0.8,
    attackRadius: 0.8,
    hitStun: 0.3,
    hitStunInterval: 1.0,
    chaseStartDistance: 12,
    chaseStopDistance: 16,
    attackDistance: 1.5,
    attackMaxHeightDiff: 1.0,
    deathHoldTime: 0.2,
    deathCollapseTime: 0.8,
    hpBarVisibleSeconds: 3,
  },
  physics: {
    playerCapsuleRadius: 0.4,
    playerCapsuleHeight: 1.7,
    gravity: 20,
    terminalVelocity: 30,
    groundCastDistance: 0.1,
    walkableMaxSlopeDeg: 35,
    wallMinSlopeDeg: 60,
    ceilingNormalY: -0.1,
    stepOffset: 0.4,
    worldBound: 30,
    separationRatio: 0.5,
  },
  climb: {
    attachReach: 0.5,
    attachAnimTime: 0.2,
    attachDistanceFromWall: 0.5,
    upSpeed: 1.0,
    downSpeed: 1.2,
    sideSpeed: 0.8,
    cliffJumpSpeed: 5.0,
    cliffJumpDuration: 0.3,
    detachSpeed: 1.0,
    staminaOutDetachSpeed: 0.5,
    hitDetachSpeed: 1.0,
    mantleTime: 0.4,
    topCheckHeight: 2.2,
    topCheckForward: 0.8,
    topCheckInset: 0.5,
    topCheckDownDistance: 2.4,
    wallReacquireDistance: 0.8,
    attachCheckHeights: [0.85, 1.7],
  },
  glide: {
    minAltitude: 2.0,
    descentSpeed: 1.5,
    descentBlendTime: 0.2,
    maxHorizontalSpeed: 4.0,
    horizontalAcceleration: 8,
    horizontalDecelTime: 2.0,
    turnSpeedDeg: 180,
  },
  hitReaction: {
    hitstop: {
      normal12: { attacker: 3, victim: 3 },
      normal3: { attacker: 5, victim: 5 },
      airAttack: { attacker: 3, victim: 3 },
      skill: { attacker: 4, victim: 4 },
      burst: { attacker: 8, victim: 8 },
      enemyAttack: { attacker: 3, victim: 4 },
      strongAttack: { attacker: 6, victim: 6 },
      shoot: { attacker: 2, victim: 2 },
      chargedShotWeak: { attacker: 4, victim: 4 },
      chargedShotStrong: { attacker: 6, victim: 6 },
    },
    attackerHitstopCapSteps: 10,
    flashSteps: 6,
    shake: {
      normal3: { amplitude: 0.05, steps: 7 },
      airAttack: { amplitude: 0.03, steps: 5 },
      skill: { amplitude: 0.08, steps: 9 },
      burst: { amplitude: 0.15, steps: 18 },
      playerHit: { amplitude: 0.1, steps: 12 },
      enemyDefeat: { amplitude: 0.06, steps: 9 },
      playerDefeat: { amplitude: 0.15, steps: 18 },
      landing: { amplitude: 0.04, steps: 6 },
      strongAttack: { amplitude: 0.08, steps: 9 },
      chargedShot: { base: 0.04, bonus: 0.08, steps: 9, maxSteps: 12 },
    },
    shakeMaxAmplitude: 0.2,
    shakeMaxSteps: 30,
    shakeFrequencyHz: 25,
    heavyLandingSpeed: 15,
    damageNumberLifetime: 0.8,
    damageNumberRise: 0.6,
    damageNumberStackOffset: 0.3,
    damageNumberMaxStack: 3,
    bigDamageThreshold: 30,
    playerDefeatAnimTime: 1.5,
  },
};
