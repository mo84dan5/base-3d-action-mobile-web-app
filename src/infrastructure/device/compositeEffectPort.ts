import type { EffectPort } from '../../application/ports';
import type { EffectEvent } from '../../application/effects';

/** 複数の EffectPort(VFX・SE・振動)へ同じ発火点を配る。 */
export class CompositeEffectPort implements EffectPort {
  constructor(private readonly ports: readonly EffectPort[]) {}

  trigger(event: EffectEvent): void {
    for (const p of this.ports) p.trigger(event);
  }
}
