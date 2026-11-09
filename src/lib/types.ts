export type Goal = 'lose_fat' | 'build_muscle' | 'get_stronger' | 'general_fitness';
export type Experience = 'beginner' | 'intermediate' | 'advanced';

export type Profile = {
  id: string;
  display_name: string | null;
  goal: Goal | null;
  experience: Experience | null;
  days_per_week: number | null;
  session_minutes: number | null;
  training_days: number[];
  injuries: string | null;
  units: 'kg' | 'lb';
  rest_threshold: number;
  timezone: string;
  onboarded_at: string | null;
};

export type PlanExercise = {
  id: string;
  day_id: string;
  position: number;
  name: string;
  equipment: string | null;
  sets: number;
  reps: string;
  rest_seconds: number | null;
  target_rpe: number | null;
  notes: string | null;
};

export type PlanDay = {
  id: string;
  plan_id: string;
  day_index: number;
  title: string;
  focus: string | null;
  is_rest: boolean;
  notes: string | null;
  plan_exercises: PlanExercise[];
};

export type WorkoutPlan = {
  id: string;
  title: string;
  summary: string | null;
  week_start: string;
  energy_score: number | null;
  plan_days: PlanDay[];
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  plan_id: string | null;
  created_at: string;
};

export const GOALS: { value: Goal; label: string; blurb: string }[] = [
  { value: 'lose_fat', label: 'Lose fat', blurb: 'Keep your strength while leaning out' },
  { value: 'build_muscle', label: 'Build muscle', blurb: 'Hypertrophy-focused training' },
  { value: 'get_stronger', label: 'Get stronger', blurb: 'Push your main lifts up' },
  { value: 'general_fitness', label: 'General fitness', blurb: 'Feel fit, strong and healthy' },
];

export const EXPERIENCE: { value: Experience; label: string; blurb: string }[] = [
  { value: 'beginner', label: 'Beginner', blurb: 'Less than 1 year of regular training' },
  { value: 'intermediate', label: 'Intermediate', blurb: '1 to 3 years' },
  { value: 'advanced', label: 'Advanced', blurb: 'More than 3 years' },
];

export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Weekday index in Spotter's convention: 0 = Monday ... 6 = Sunday. */
export function todayIndex(): number {
  return (new Date().getDay() + 6) % 7;
}
