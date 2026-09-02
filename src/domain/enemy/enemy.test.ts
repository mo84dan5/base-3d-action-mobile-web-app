import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/gameConfig';
import { resolveHit } from '../combat/damage';
import { vec3 } from '../math/vec3';
import { stepEnemyAi, telegraphOpacity, type EnemyEvent } from './enemyAi';
import {
  applyEnemyHit,
  canEnemyBeStunned,
  createEnemy,
  deathProgress,
  isTargetable,
  releasePendingReactions,
  tickDeath,
  type EnemyState,
} from './enemyState';

const config = defaultConfig;
const enemyConfig = config.enemy;
const DT = 1 / 60;
const playerCenterAt = (x: number, z: number, y = 0.85) => vec3(x, y, z);

function run(
  enemy: EnemyState,
  seconds: number,
  playerCenter = playerCenterAt(0, 0),
): { enemy: EnemyState; events: EnemyEvent[] } {
  const events: EnemyEvent[] = [];
  let e = enemy;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const r = stepEnemyAi(e, playerCenter, true, DT, enemyConfig);
    e = r.enemy;
    events.push(...r.events);
  }
  return { enemy: e, events };
}

describe('徘徊型の AI(F04)', () => {
  it('プレイヤーが 12 m 以内に入ると追跡を始め、2.0 m/s で近づく', () => {
    const enemy = createEnemy(1, 'patrol', vec3(0, 0, 11), enemyConfig);
    const r = stepEnemyAi(enemy, playerCenterAt(0, 0), true, DT, enemyConfig);
    expect(r.enemy.ai).toBe('chase');
    const r2 = stepEnemyAi(r.enemy, playerCenterAt(0, 0), true, DT, enemyConfig);
    expect(r2.enemy.velocity.z).toBeCloseTo(-2.0);
  });
  it('13 m 離れていると待機のまま動かない', () => {
    const enemy = createEnemy(1, 'patrol', vec3(0, 0, 13), enemyConfig);
    const r = stepEnemyAi(enemy, playerCenterAt(0, 0), true, DT, enemyConfig);
    expect(r.enemy.ai).toBe('idle');
    expect(r.enemy.velocity).toEqual(vec3(0, 0, 0));
  });
  it('追跡中にプレイヤーが 16 m 以上離れると待機に戻る', () => {
    const enemy = {
      ...createEnemy(1, 'patrol', vec3(0, 0, 16), enemyConfig),
      ai: 'chase' as const,
    };
    const r = stepEnemyAi(enemy, playerCenterAt(0, 0), true, DT, enemyConfig);
    expect(r.enemy.ai).toBe('idle');
  });
  it('1.5 m 以内で攻撃を開始し、発生 0.6 秒後に正面 0.8 m・半径 0.8 m の当たり判定が出て、全体 1.5 秒で終わる', () => {
    const enemy = {
      ...createEnemy(1, 'patrol', vec3(0, 0, 1.2), enemyConfig),
      ai: 'chase' as const,
    };
    const { enemy: after, events } = run(enemy, 1.6);
    expect(events[0]?.type).toBe('attackStart');
    const active = events.filter((e) => e.type === 'attackActive');
    expect(active.length).toBeGreaterThan(0);
    const first = active[0];
    if (first?.type !== 'attackActive') throw new Error('unreachable');
    expect(first.radius).toBe(0.8);
    expect(first.sphereCenter.z).toBeCloseTo(1.2 - 0.8);
    expect(events.some((e) => e.type === 'attackEnd')).toBe(true);
    expect(after.ai).toBe('chase');
    expect(after.attackCooldownRemaining).toBeGreaterThan(1.8);
  });
  it('攻撃後 2.0 秒のクールダウン中は 1.5 m 以内でも攻撃しない', () => {
    const enemy = {
      ...createEnemy(1, 'patrol', vec3(0, 0, 1.2), enemyConfig),
      ai: 'chase' as const,
    };
    const { enemy: after } = run(enemy, 1.6);
    const { events } = run(after, 1.5);
    expect(events.some((e) => e.type === 'attackStart')).toBe(false);
  });
  it('高低差 6 m のプレイヤー(台地上)には攻撃しない', () => {
    const enemy = {
      ...createEnemy(1, 'patrol', vec3(0, 0, 1.0), enemyConfig),
      ai: 'chase' as const,
    };
    const r = stepEnemyAi(enemy, playerCenterAt(0, 0, 6.85), true, DT, enemyConfig);
    expect(r.enemy.ai).toBe('chase');
  });
  it('ダミーは 12 m 以内でも何もしない', () => {
    const enemy = createEnemy(1, 'dummy', vec3(0, 0, 3), enemyConfig);
    const r = stepEnemyAi(enemy, playerCenterAt(0, 0), true, DT, enemyConfig);
    expect(r.enemy).toBe(enemy);
  });
  it('ヒットストップ中(dt = 0)は状態が進まない', () => {
    const enemy = {
      ...createEnemy(1, 'patrol', vec3(0, 0, 1.2), enemyConfig),
      ai: 'chase' as const,
    };
    const r = stepEnemyAi(enemy, playerCenterAt(0, 0), true, 0, enemyConfig);
    expect(r.enemy).toBe(enemy);
  });
  it('予兆は発生の最後の 0.15 秒で不透明 80% になる', () => {
    const enemy = {
      ...createEnemy(1, 'patrol', vec3(0, 0, 1), enemyConfig),
      ai: 'attack' as const,
      stateTime: 0.3,
    };
    expect(telegraphOpacity(enemy, enemyConfig)).toBe(0.5);
    expect(telegraphOpacity({ ...enemy, stateTime: 0.5 }, enemyConfig)).toBe(0.8);
    expect(telegraphOpacity({ ...enemy, stateTime: 0.7 }, enemyConfig)).toBe(0);
  });
});

function hitPatrol(enemy: EnemyState, worldTime: number, damage = 10) {
  const resolution = resolveHit(
    {
      attackKind: 'normal1',
      attackId: 1,
      attackerId: 'player',
      victimId: enemy.id,
      damage,
      attackerCenter: vec3(0, 0.85, 0),
      victimCenter: vec3(enemy.position.x, 0.9, enemy.position.z),
      victimYaw: enemy.yaw,
      victimCategory: enemy.kind === 'dummy' ? 'enemyDummy' : 'enemyPatrol',
      victimInvincible: false,
      enemyStunAvailable: canEnemyBeStunned(enemy, worldTime, enemyConfig),
    },
    config,
  );
  if (!resolution) throw new Error('hit ignored');
  return applyEnemyHit(enemy, resolution, worldTime, config);
}

describe('敵の被弾(F04 / F10)', () => {
  it('通常攻撃 10 ダメージで HP 60 → 50、ヒットストップ 3 ステップ、白フラッシュ', () => {
    const enemy = createEnemy(1, 'patrol', vec3(0, 0, 1.5), enemyConfig);
    const hit = hitPatrol(enemy, 0);
    expect(hit.hp).toBe(50);
    expect(hit.hitstopSteps).toBe(3);
    expect(hit.flash?.color).toBe('white');
    expect(hit.hpBarVisibleRemaining).toBe(3);
  });
  it('硬直・ノックバックはヒットストップ終了後に releasePendingReactions で始まる', () => {
    const enemy = createEnemy(1, 'patrol', vec3(0, 0, 1.5), enemyConfig);
    const hit = hitPatrol(enemy, 0);
    expect(hit.ai).toBe('idle');
    expect(hit.pending?.stunSeconds).toBe(0.3);
    const released = releasePendingReactions(hit);
    expect(released.ai).toBe('stunned');
    expect(released.stunRemaining).toBe(0.3);
    expect(released.knockback.z).toBeCloseTo(1.7);
    expect(released.knockbackRemaining).toBe(0.3);
  });
  it('硬直は 1.0 秒に 1 回のみ(連打で永久に硬直しない)が、ダメージは毎回入る', () => {
    const enemy = createEnemy(1, 'patrol', vec3(0, 0, 1.5), enemyConfig);
    const first = releasePendingReactions(hitPatrol(enemy, 0));
    expect(first.ai).toBe('stunned');
    const second = releasePendingReactions(hitPatrol({ ...first, ai: 'chase' }, 0.5));
    expect(second.ai).toBe('chase');
    expect(second.hp).toBe(40);
    const third = releasePendingReactions(hitPatrol({ ...second, ai: 'chase' }, 1.0));
    expect(third.ai).toBe('stunned');
  });
  it('硬直は 0.3 秒で終わり追跡へ戻る', () => {
    const enemy = createEnemy(1, 'patrol', vec3(0, 0, 1.5), enemyConfig);
    const stunned = releasePendingReactions(hitPatrol(enemy, 0));
    const { enemy: after, events } = run(stunned, 0.31);
    expect(after.ai).toBe('chase');
    expect(events.some((e) => e.type === 'stunEnd')).toBe(true);
  });
  it('ダミーは HP 0 になると即時に全回復し、硬直もノックバックもしない', () => {
    const dummy = createEnemy(2, 'dummy', vec3(0, 0, 1.5), enemyConfig);
    const hit = hitPatrol(dummy, 0, 200);
    expect(hit.hp).toBe(200);
    expect(hit.ai).toBe('idle');
    expect(hit.hitstopSteps).toBe(3);
    expect(releasePendingReactions(hit).knockbackRemaining).toBe(0);
  });
  it('徘徊型は HP 0 で撃破演出(dying)に入り、0.2 秒静止 + 0.8 秒の崩れの後に dead になる', () => {
    const enemy = createEnemy(1, 'patrol', vec3(0, 0, 1.5), enemyConfig);
    const hit = hitPatrol(enemy, 0, 60);
    expect(hit.hp).toBe(0);
    expect(hit.ai).toBe('dying');
    expect(isTargetable(hit)).toBe(false);
    expect(deathProgress(hit, enemyConfig).phase).toBe('hold');
    let e = hit;
    for (let i = 0; i < 18; i++) e = tickDeath(e, DT, enemyConfig);
    expect(deathProgress(e, enemyConfig).phase).toBe('collapse');
    for (let i = 0; i < 48; i++) e = tickDeath(e, DT, enemyConfig);
    expect(e.ai).toBe('dead');
    expect(deathProgress(e, enemyConfig).phase).toBe('done');
  });
});
