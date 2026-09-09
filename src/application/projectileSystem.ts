import { enemyCenter, isTargetable } from '../domain/enemy/enemyState';
import { distance, type Vec3 } from '../domain/math/vec3';
import { playerCenter } from '../domain/player/playerStep';
import type { PlayerEvent } from '../domain/player/playerEvents';
import {
  createProjectile,
  onProjectileHit,
  projectileYaw,
  stepProjectile,
  sweptDistance,
  type Projectile,
  type ProjectileEnd,
} from '../domain/projectile/projectile';
import type { CombatHost } from './combatHost';
import { applyVolumeHit, HitBatch, enemyCapsuleOf } from './playerHits';
import type { ProjectileView } from './viewState';

// 発射体(F11 N1)の集合。生成・前進・命中・爆発をセッションの 1 ステップとして進める。

export class ProjectileSystem {
  projectiles: Projectile[] = [];
  private nextId = 1;

  spawn(host: CombatHost, event: Extract<PlayerEvent, { type: 'projectileSpawned' }>): void {
    const pr = createProjectile(
      this.nextId++,
      event.attackId,
      event.spec,
      event.kind,
      event.profile,
      event.styleId,
      event.origin,
      event.direction,
      event.damage,
      event.range,
    );
    this.projectiles.push(pr);
    host.effect({
      kind: 'projectileLaunch',
      position: event.origin,
      yaw: projectileYaw(pr),
      styleId: event.styleId,
    });
  }

  /** 戻るまで次を投げられない(ブーメラン)。 */
  hasReturning(): boolean {
    return this.projectiles.some((p) => p.alive && p.spec.returning);
  }

  step(host: CombatHost, dt: number): void {
    if (dt <= 0) return;
    const center = playerCenter(host.player, host.config);
    for (let i = 0; i < this.projectiles.length; i++) {
      let pr = this.projectiles[i];
      if (!pr?.alive) continue;
      const previous = pr.position;
      const homing = this.nearestEnemyCenter(host, pr.position);
      const r = stepProjectile(
        pr,
        {
          playerCenter: center,
          homingTarget: homing,
          terrain: host.terrain,
          gravity: host.config.physics.gravity,
        },
        dt,
      );
      pr = r.projectile;
      const ends: ProjectileEnd[] = [...r.ends];
      if (pr.alive) {
        const hit = this.collide(host, pr, previous);
        if (hit) {
          const after = onProjectileHit(pr, hit);
          pr = after.projectile;
          ends.push(...after.ends);
        }
      }
      for (const end of ends) {
        if (end.type === 'explode') {
          applyVolumeHit(
            host,
            {
              kind: pr.kind,
              attackId: pr.attackId,
              damage: end.damage,
              profile: pr.profile,
              attackerHitstop: false,
            },
            { type: 'sphere', center: end.center, radius: end.radius },
            [],
          );
          host.effect({
            kind: 'explosion',
            position: end.center,
            radius: end.radius,
            styleId: pr.styleId,
          });
        }
      }
      this.projectiles[i] = pr;
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  private nearestEnemyCenter(host: CombatHost, from: Vec3): Vec3 | null {
    let best: Vec3 | null = null;
    let bestDist = Infinity;
    for (const slot of host.enemies) {
      if (!isTargetable(slot.state)) continue;
      const c = enemyCenter(slot.state, host.config.enemy);
      const d = distance(c, from);
      if (d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    return best;
  }

  /** 弾の掃引線分と敵カプセルの重なりで命中を判定する。当たった敵 ID を返す。 */
  private collide(host: CombatHost, pr: Projectile, previous: Vec3): number | null {
    for (const slot of host.enemies) {
      const enemy = slot.state;
      if (!isTargetable(enemy) || pr.hitTargets.includes(enemy.id)) continue;
      const capsule = enemyCapsuleOf(host, slot);
      const c = enemyCenter(enemy, host.config.enemy);
      const half = capsule.height / 2 - capsule.radius;
      const clampedY = Math.min(c.y + half, Math.max(c.y - half, pr.position.y));
      const axisPoint = { x: c.x, y: clampedY, z: c.z };
      if (sweptDistance(pr, previous, axisPoint) > pr.spec.radius + capsule.radius) continue;
      const batch = new HitBatch(host, {
        kind: pr.kind,
        attackId: pr.attackId,
        damage: pr.spec.explosion ? 0 : pr.damage,
        profile: pr.profile,
        attackerHitstop: false,
      });
      if (!pr.spec.explosion) batch.hit(slot, pr.position, pr.position);
      batch.finish();
      return enemy.id;
    }
    return null;
  }

  view(): ProjectileView[] {
    return this.projectiles.map((p) => ({
      id: p.id,
      position: p.position,
      yaw: projectileYaw(p),
      radius: p.spec.radius,
      styleId: p.styleId,
      returning: p.phase === 'return',
      velocity: p.velocity,
    }));
  }
}
