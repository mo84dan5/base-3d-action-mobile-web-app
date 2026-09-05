import { enemyCenter, isTargetable } from '../domain/enemy/enemyState';
import { normalize, sub } from '../domain/math/vec3';
import type { NearbyEnemy } from '../domain/placed/placedObject';
import type { PlayerEvent } from '../domain/player/playerEvents';
import { commandSummon, createSummon, stepSummon, type Summon } from '../domain/summon/summon';
import type { CombatHost } from './combatHost';
import { applyRayHit, applyVolumeHit } from './playerHits';
import type { SummonView } from './viewState';

// 召喚体(F11 N4)の集合。

export class SummonSystem {
  summons: Summon[] = [];
  private nextId = 1;

  summon(host: CombatHost, event: Extract<PlayerEvent, { type: 'summoned' }>): void {
    const spec = event.spec;
    // 同じ種類は置き換える(浮遊剣は本数ぶん)
    this.summons = this.summons.filter((s) => s.spec.entity !== spec.entity);
    for (let slot = 0; slot < spec.count; slot++) {
      this.summons.push(
        createSummon(
          this.nextId++,
          event.attackId,
          spec,
          event.kind,
          event.profile,
          event.styleId,
          event.position,
          event.yaw,
          slot,
        ),
      );
    }
    host.effect({
      kind: 'summon',
      entity: spec.entity,
      position: event.position,
      styleId: event.styleId,
    });
  }

  command(event: Extract<PlayerEvent, { type: 'summonCommand' }>): void {
    this.summons = this.summons.map((s) =>
      s.spec.entity === event.entity ? commandSummon(s, event.command) : s,
    );
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
    for (let i = 0; i < this.summons.length; i++) {
      const s = this.summons[i];
      if (!s?.alive) continue;
      const r = stepSummon(s, enemies, host.player.position, host.player.yaw, dt);
      this.summons[i] = r.summon;
      for (const a of r.actions) {
        switch (a.type) {
          case 'bolt': {
            const slot = host.enemies.find((e) => e.state.id === a.targetId);
            if (!slot) break;
            const target = enemyCenter(slot.state, host.config.enemy);
            const dir = normalize(sub(target, a.from));
            const results = applyRayHit(
              host,
              {
                kind: s.kind,
                attackId: a.attackId + Math.round(s.age * 1000),
                damage: a.damage,
                profile: s.profile,
                attackerHitstop: false,
              },
              {
                origin: a.from,
                directions: [dir],
                range: s.spec.range + 1,
                pierce: false,
                beamWidth: 0,
                charged: false,
                chargeRatio: 0,
              },
              a.from,
            );
            host.effect({
              kind: 'tracer',
              from: a.from,
              to: results[0]?.end ?? target,
              charged: false,
              chargeRatio: 0,
            });
            break;
          }
          case 'area':
            applyVolumeHit(
              host,
              {
                kind: s.kind,
                attackId: a.attackId + Math.round(s.age * 1000),
                damage: a.damage,
                profile: s.profile,
                attackerHitstop: false,
              },
              { type: 'sphere', center: a.center, radius: a.radius },
              [],
              a.center,
            );
            host.effect({
              kind: 'summonStrike',
              entity: s.spec.entity,
              position: a.center,
              radius: a.radius,
              styleId: s.styleId,
            });
            break;
          case 'expired':
            host.effect({
              kind: 'summonExpire',
              entity: s.spec.entity,
              position: s.position,
              styleId: s.styleId,
            });
            break;
        }
      }
    }
    this.summons = this.summons.filter((s) => s.alive);
  }

  view(): SummonView[] {
    return this.summons.map((s) => ({
      id: s.id,
      entity: s.spec.entity,
      position: s.position,
      phase: s.phase,
      styleId: s.styleId,
    }));
  }
}
