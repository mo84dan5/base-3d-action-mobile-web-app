import type { Clock } from '../../application/ports';

export class PerformanceClock implements Clock {
  now(): number {
    return performance.now() / 1000;
  }
}
