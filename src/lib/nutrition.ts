import type { Goal, MealLog, Profile } from './types';

export type Targets = { calories: number; protein_g: number; carbs_g: number; fat_g: number };

export const LB_PER_KG = 2.20462;
export const CM_PER_IN = 2.54;

/** Grams of protein per kg of body weight, by goal. */
const PROTEIN_PER_KG: Record<Goal, number> = {
  lose_fat: 2.2,
  build_muscle: 2.0,
  get_stronger: 1.8,
  general_fitness: 1.6,
};

/** Calorie change from maintenance, by goal. */
const CALORIE_ADJUST: Record<Goal, number> = {
  lose_fat: -0.2,
  build_muscle: 0.1,
  get_stronger: 0.05,
  general_fitness: 0,
};

function activityFactor(daysPerWeek: number): number {
  if (daysPerWeek <= 1) return 1.3;
  if (daysPerWeek <= 3) return 1.45;
  if (daysPerWeek <= 5) return 1.55;
  return 1.7;
}

/**
 * Daily targets from body stats and goal (Mifflin-St Jeor BMR x activity,
 * adjusted for the goal). Returns null when body stats are missing.
 */
export function suggestTargets(p: Pick<Profile, 'sex' | 'birth_year' | 'height_cm' | 'weight_kg' | 'goal' | 'days_per_week'>): Targets | null {
  if (!p.sex || !p.birth_year || !p.height_cm || !p.weight_kg) return null;
  const age = new Date().getFullYear() - p.birth_year;
  const w = Number(p.weight_kg);
  const h = Number(p.height_cm);
  const bmr = 10 * w + 6.25 * h - 5 * age + (p.sex === 'male' ? 5 : -161);
  const goal: Goal = p.goal ?? 'general_fitness';
  const calories = Math.round((bmr * activityFactor(p.days_per_week ?? 3) * (1 + CALORIE_ADJUST[goal])) / 10) * 10;
  const protein_g = Math.round(w * PROTEIN_PER_KG[goal]);
  const fat_g = Math.round(w * 0.8);
  const carbs_g = Math.max(0, Math.round((calories - protein_g * 4 - fat_g * 9) / 4));
  return { calories, protein_g, carbs_g, fat_g };
}

export function profileTargets(p: Profile | null): Targets | null {
  if (!p?.calorie_target || !p.protein_target_g) return null;
  return {
    calories: p.calorie_target,
    protein_g: p.protein_target_g,
    carbs_g: p.carbs_target_g ?? 0,
    fat_g: p.fat_target_g ?? 0,
  };
}

export type Totals = { calories: number; protein_g: number; carbs_g: number; fat_g: number };

export function sumMeals(meals: Pick<MealLog, 'calories' | 'protein_g' | 'carbs_g' | 'fat_g'>[]): Totals {
  const sum = (k: keyof Totals) => Math.round(meals.reduce((t, m) => t + (Number(m[k]) || 0), 0));
  return { calories: sum('calories'), protein_g: sum('protein_g'), carbs_g: sum('carbs_g'), fat_g: sum('fat_g') };
}

/** Midnight today on this phone, as an ISO string. */
export function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Choices for the meal reminder time ("HH:MM"). */
export const REMINDER_TIMES = ['17:00', '18:00', '19:00', '20:00', '21:00'];

export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, '0')} ${suffix}` : `${hour} ${suffix}`;
}
