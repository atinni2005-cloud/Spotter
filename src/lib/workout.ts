import type { SetLog } from './types';

/** Lowest and highest reps in a target like "8-12", "5" or "10-12 each side". */
export function repRange(reps: string): { low: number; high: number } | null {
  const nums = (reps.match(/\d+/g) ?? []).map(Number).filter((n) => n > 0 && n < 100);
  if (!nums.length) return null;
  return { low: Math.min(nums[0], nums[1] ?? nums[0]), high: Math.max(nums[0], nums[1] ?? nums[0]) };
}

export type Advice = { suggestedWeight: number | null; text: string };

/**
 * Progressive overload hint from the last session of this exercise:
 * every set at the top of the rep range -> go heavier; otherwise beat last time.
 */
export function overloadAdvice(last: SetLog[], targetReps: string, units: 'kg' | 'lb'): Advice | null {
  if (!last.length) return null;
  const range = repRange(targetReps);
  const weights = last.map((s) => Number(s.weight) || 0);
  const topWeight = Math.max(...weights);
  const atTop = last.filter((s) => (Number(s.weight) || 0) === topWeight);
  const step = units === 'lb' ? 5 : 2.5;

  if (!range || topWeight === 0) {
    return { suggestedWeight: topWeight || null, text: 'Try to beat last time by one rep per set.' };
  }
  if (atTop.every((s) => (s.reps ?? 0) >= range.high)) {
    return {
      suggestedWeight: topWeight + step,
      text: `You hit ${range.high} reps on every set last time. Go heavier: try ${topWeight + step} ${units}.`,
    };
  }
  if (atTop.some((s) => (s.reps ?? 0) < range.low)) {
    return {
      suggestedWeight: topWeight,
      text: `Stay at ${topWeight} ${units} until you reach ${range.low} reps on every set.`,
    };
  }
  return {
    suggestedWeight: topWeight,
    text: `Stay at ${topWeight} ${units} and add a rep where you can. At ${range.high} reps on every set, go up ${step} ${units}.`,
  };
}

export function describeSets(sets: SetLog[], units: string): string {
  return sets
    .map((s) => (s.weight ? `${Number(s.weight)}${units}×${s.reps ?? '?'}` : `${s.reps ?? '?'} reps`))
    .join(', ');
}

/** Sets for today, lightened when energy is low (same rule as the coach). */
export function lightenedSets(sets: number, energy: number | null): number {
  if (energy === null || energy >= 50) return sets;
  return Math.max(1, Math.ceil((sets * 2) / 3));
}
