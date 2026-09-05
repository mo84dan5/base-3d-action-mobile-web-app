import { enemyCenter, isTargetable, pushEnemy } from '../domain/enemy/enemyState';
import { add, horizontal, normalize, scale, sub, vec3, type Vec3 } from '../domain/math/vec3';
import {
  boost,
  createPlacedObject,
  detonate,
  push,
  pushOutOfWall,
  stepPlacedObject,
  type NearbyEnemy,
  type PlacedAction,
  type PlacedObject,
} from '../domain/placed/placedObject';
import type { PlayerEvent } from '../domain/player/playerEvents';
import type { CombatHost } from './combatHost';
import { applyRayHit, applyVolumeHit, HitBatch } from './playerHits';
import type { PlacedView } from './viewState';

// 設置物(F11 N3)の集合。

export class PlacedSystem {
  objects: PlacedObject[] = [];
  private nextId = 1;

  place(host: CombatHost, event: Extract<PlayerEvent, { type: 'objectPlaced' }>): void {
    const spec = event.spec;
    const same = this.objects.filter((o) => o.alive && o.spec.object === spec.object);
    while (same.length >= spec.maxCount) {
      const oldest = same.shift();
      this.objects = this.objects.filter((o) => o !== oldest);
    }
    const obj = createPlacedObject(
      this.nextId++,
      event.attackId,
      spec,
      event.kind,
      event.profile,
      event.styleId,
      event.position,
      event.yaw,
    );
    this.objects.push(obj);
    host.effect({
      kind: 'placed',
      object: spec.object,
      position: event.position,
      radius: spec.radius,
      styleId: event.styleId,
    });
  }

  command(host: CombatHost, event: Extract<PlayerEvent, { type: 'placedCommand' }>): void {
    const targets = this.objects.filter((o) => o.alive && o.spec.object === event.object);
    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];
      if (!obj || !targets.includes(obj)) continue;
      switch (event.command) {
        case 'detonateAll': {
          const r = detonate(obj, event.spec.damage, event.spec.radius);
          this.objects[i] = r.object;
          this.applyActions(host, obj, r.actions);
          break;
        }
        case 'boost':
          this.objects[i] = boost(obj);
          break;
        case 'push':
          this.objects[i] = {
            ...push(obj, event.spec.rollSpeed ?? 4.0),
            spec: { ...obj.spec, damage: event.spec.damage },
          };
          break;
      }
    }
    this.objects = this.objects.filter((o) => o.alive);
  }

  /** 敵の追跡先を囮にする(生存中の囮の中心)。 */
  decoyCenter(): Vec3 | null {
    const decoy = this.objects.find((o) => o.alive && o.spec.object === 'decoy');
    return decoy ? add(decoy.position, vec3(0, 0.85, 0)) : null;
  }

  step(host: CombatHost, dt: number): void {
    if (dt <= 0) return;
    const enemies: NearbyEnemy[] = host.enemies
      .filter((s) => isTargetable(s.state))
      .map((s) => ({
        id: s.state.id,
        feet: s.state.position,
        center: enemyCenter(s.state, host.config.enemy),
      }));
    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];
      if (!obj?.alive) continue;
      const r = stepPlacedObject(obj, enemies, dt);
      this.objects[i] = r.object;
      this.applyActions(host, r.object, r.actions, dt);
    }
    this.objects = this.objects.filter((o) => o.alive);
  }

  /** 壁の外へ敵を押し出す(敵 AI のみ遮る)。 */
  blockEnemies(host: CombatHost): void {
    for (const obj of this.objects) {
      if (!obj.alive || obj.spec.object !== 'wall') continue;
      for (const slot of host.enemies) {
        if (!isTargetable(slot.state)) continue;
        const pushed = pushOutOfWall(obj, slot.state.position, host.config.enemy.capsuleRadius);
        if (pushed) slot.state = { ...slot.state, position: pushed };
      }
    }
  }

  private applyActions(
    host: CombatHost,
    obj: PlacedObject,
    actions: readonly PlacedAction[],
    dt = 0,
  ): void {
    for (const a of actions) {
      switch (a.type) {
        case 'explode':
        case 'tick':
          applyVolumeHit(
            host,
            {
              kind: obj.kind,
              attackId: a.attackId + (a.type === 'tick' ? Math.round(obj.age * 1000) : 0),
              damage: a.damage,
              profile: obj.profile,
              attackerHitstop: false,
            },
            { type: 'sphere', center: a.center, radius: a.radius },
            [],
            a.center,
          );
          if (a.type === 'explode')
            host.effect({
              kind: 'explosion',
              position: a.center,
              radius: a.radius,
              styleId: obj.styleId,
            });
          else
            host.effect({
              kind: 'fieldPulse',
              position: a.center,
              radius: a.radius,
              styleId: obj.styleId,
            });
          break;
        case 'shoot': {
          const slot = host.enemies.find((s) => s.state.id === a.targetId);
          if (!slot) break;
          const target = enemyCenter(slot.state, host.config.enemy);
          const dir = normalize(sub(target, a.from));
          const results = applyRayHit(
            host,
            {
              kind: obj.kind,
              attackId: a.attackId + Math.round(obj.age * 1000),
              damage: a.damage,
              profile: obj.profile,
              attackerHitstop: false,
            },
            {
              origin: a.from,
              directions: [dir],
              range: obj.spec.radius + 1,
              pierce: false,
              beamWidth: 0,
              charged: false,
              chargeRatio: 0,
            },
            a.from,
          );
          const end = results[0]?.end ?? target;
          host.effect({ kind: 'tracer', from: a.from, to: end, charged: false, chargeRatio: 0 });
          break;
        }
        case 'pull':
          for (const slot of host.enemies) {
            if (!isTargetable(slot.state)) continue;
            const to = horizontal(sub(a.center, slot.state.position));
            const d = Math.hypot(to.x, to.z);
            if (d > a.radius || d < 0.3) continue;
            slot.state = pushEnemy(slot.state, scale(normalize(to), a.speed), dt);
          }
          break;
        case 'touch': {
          const slot = host.enemies.find((s) => s.state.id === a.targetId);
          if (!slot) break;
          const batch = new HitBatch(host, {
            kind: obj.kind,
            attackId: a.attackId,
            damage: a.damage,
            profile: obj.profile,
            attackerHitstop: false,
          });
          batch.hit(
            slot,
            enemyCenter(slot.state, host.config.enemy),
            add(obj.position, vec3(0, 0.85, 0)),
          );
          batch.finish();
          break;
        }
        case 'expired':
          host.effect({
            kind: 'placedExpire',
            object: obj.spec.object,
            position: obj.position,
            styleId: obj.styleId,
          });
          break;
      }
    }
  }

  view(): PlacedView[] {
    return this.objects.map((o) => ({
      id: o.id,
      object: o.spec.object,
      position: o.position,
      yaw: o.yaw,
      radius: o.spec.radius,
      progress:
        o.spec.delay > 0
          ? Math.min(1, o.age / o.spec.delay)
          : Math.min(1, o.age / Math.max(0.01, o.spec.lifetime)),
      styleId: o.styleId,
    }));
  }
}
