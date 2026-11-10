export type Goal = 'lose_fat' | 'build_muscle' | 'get_stronger' | 'general_fitness';
export type TrainingSplit =
  | 'auto'
  | 'full_body'
  | 'upper_lower'
  | 'push_pull_legs'
  | 'bro_split'
  | 'arnold'
  | 'custom';

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
  training_split: TrainingSplit;
  split_notes: string | null;
  exercises_per_session: number | null;
  onboarded_at: string | null;
  sex: 'male' | 'female' | null;
  birth_year: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  calorie_target: number | null;
  protein_target_g: number | null;
  carbs_target_g: number | null;
  fat_target_g: number | null;
  /** "HH:MM:SS" or null when reminders are off. */
  meal_reminder_time: string | null;
};

export type MealLog = {
  id: string;
  name: string | null;
  description: string | null;
  eaten_at: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  confidence: number | null;
  source: 'photo' | 'text' | 'manual';
};

export type SavedRecipe = {
  id: string;
  title: string;
  description: string | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  servings: number;
  ingredients: { name: string; amount: string }[];
  steps: string[];
  created_at: string;
};

export type SetLog = {
  id: string;
  session_id: string;
  exercise_id: string | null;
  exercise_name: string;
  set_number: number;
  reps: number | null;
  weight: number | null;
  created_at: string;
};

export type FormFeedback = {
  verdict: 'good' | 'minor_fixes' | 'needs_work' | 'unclear';
  headline: string;
  rep_count: number;
  went_well: string[];
  fixes: { issue: string; why: string; cue: string }[];
  safety: string;
  next_set: string;
  camera_tip: string;
  error?: string;
};

export type FormCheck = {
  id: string;
  exercise_name: string;
  status: 'uploaded' | 'processing' | 'done' | 'failed';
  feedback: FormFeedback | null;
  created_at: string;
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
  /** Set when the user swapped this exercise because the machine was taken. */
  swapped_from?: { name: string; equipment: string | null; reps: string; notes: string | null } | null;
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

export const SPLITS: { value: TrainingSplit; label: string; blurb: string }[] = [
  { value: 'auto', label: 'Let my coach choose', blurb: 'Best fit for your goal and schedule' },
  { value: 'push_pull_legs', label: 'Push / Pull / Legs', blurb: 'Chest-shoulders-triceps, back-biceps, legs' },
  { value: 'upper_lower', label: 'Upper / Lower', blurb: 'Alternate upper body and lower body days' },
  { value: 'full_body', label: 'Full body', blurb: 'Whole body every session' },
  { value: 'bro_split', label: 'Bro split', blurb: 'One main muscle group per day' },
  { value: 'arnold', label: 'Arnold split', blurb: 'Chest + back, shoulders + arms, legs' },
  { value: 'custom', label: 'Something else', blurb: 'Describe your own split' },
];

/** Choices for "exercises per session". null = let the coach decide. */
export const EXERCISE_COUNTS: (number | null)[] = [3, 4, 5, 6, 7, 8, null];

/** A YouTube search for a demo of the exercise with good form. */
export function exerciseVideoUrl(name: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`how to ${name} proper form`)}`;
}

export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Weekday index in Spotter's convention: 0 = Monday ... 6 = Sunday. */
export function todayIndex(): number {
  return (new Date().getDay() + 6) % 7;
}
