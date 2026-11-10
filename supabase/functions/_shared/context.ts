import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type Profile = {
  id: string;
  display_name: string | null;
  goal: "lose_fat" | "build_muscle" | "get_stronger" | "general_fitness" | null;
  experience: "beginner" | "intermediate" | "advanced" | null;
  days_per_week: number | null;
  session_minutes: number | null;
  training_days: number[];
  injuries: string | null;
  units: "kg" | "lb";
  rest_threshold: number;
  timezone: string;
  training_split: string;
  split_notes: string | null;
  exercises_per_session: number | null;
};

export type Energy = { score: number; created_at: string } | null;

export const GOAL_LABEL: Record<string, string> = {
  lose_fat: "lose fat",
  build_muscle: "build muscle",
  get_stronger: "get stronger",
  general_fitness: "general fitness",
};

export const SPLIT_LABEL: Record<string, string> = {
  auto: "no preference (coach chooses the best split for their goal and schedule)",
  full_body: "full body every session",
  upper_lower: "upper / lower",
  push_pull_legs: "push / pull / legs",
  bro_split: "bro split (one main muscle group per day: e.g. chest, back, shoulders, legs, arms)",
  arnold: "Arnold split (chest + back / shoulders + arms / legs)",
  custom: "custom",
};

export function describeSplit(p: Profile): string {
  if (p.training_split === "custom") {
    return p.split_notes?.trim() ? `custom: ${p.split_notes.trim()}` : "custom (not described)";
  }
  return SPLIT_LABEL[p.training_split] ?? SPLIT_LABEL.auto;
}

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Today's date (YYYY-MM-DD) and weekday index (0 = Monday) in the user's timezone. */
export function today(timezone: string): { date: string; dayIndex: number } {
  let tz = timezone;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date());
  const dayIndex = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
  return { date, dayIndex };
}

/** Monday of the current week in the user's timezone. */
export function weekStart(timezone: string): string {
  const { date, dayIndex } = today(timezone);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dayIndex);
  return d.toISOString().slice(0, 10);
}

export async function loadProfile(supabase: SupabaseClient, userId: string): Promise<Profile> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (error) throw error;
  return data as Profile;
}

/** Most recent energy check-in from the last 18 hours, if any. */
export async function loadRecentEnergy(supabase: SupabaseClient): Promise<Energy> {
  const since = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("energy_checkins")
    .select("score, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/** Compact text description of the user's active plan, for the coach's context. */
export async function describeActivePlan(supabase: SupabaseClient): Promise<string | null> {
  const { data: plan } = await supabase
    .from("workout_plans")
    .select("id, title, week_start, summary, plan_days(day_index, title, is_rest, plan_exercises(name, sets, reps, position))")
    .eq("status", "active")
    .maybeSingle();
  if (!plan) return null;

  // deno-lint-ignore no-explicit-any
  const days = [...((plan as any).plan_days ?? [])].sort((a, b) => a.day_index - b.day_index);
  const lines = days.map((d) => {
    if (d.is_rest) return `- ${DAY_NAMES[d.day_index]}: ${d.title} (rest)`;
    const exercises = [...(d.plan_exercises ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((e) => `${e.name} ${e.sets}x${e.reps}`)
      .join(", ");
    return `- ${DAY_NAMES[d.day_index]}: ${d.title}: ${exercises}`;
  });
  return `"${plan.title}" (week of ${plan.week_start})\n${lines.join("\n")}`;
}

export function describeProfile(p: Profile): string {
  const days = p.training_days?.length
    ? p.training_days.map((i) => DAY_NAMES[i]).join(", ")
    : "not set";
  return [
    `Name: ${p.display_name ?? "unknown"}`,
    `Goal: ${p.goal ? GOAL_LABEL[p.goal] : "not set"}`,
    `Experience: ${p.experience ?? "not set"}`,
    `Training days per week: ${p.days_per_week ?? "not set"} (preferred days: ${days})`,
    `Session length: ${p.session_minutes ?? "not set"} minutes`,
    `Preferred training split: ${describeSplit(p)}`,
    `Exercises per session: ${p.exercises_per_session ?? "no preference (coach decides, usually 4-6)"}`,
    `Injuries or limits: ${p.injuries?.trim() || "none reported"}`,
    `Units: ${p.units}`,
    `Rest threshold: suggest rest when energy is below ${p.rest_threshold}%`,
  ].join("\n");
}

/**
 * Plain-language guidance derived from today's energy, so the rule is applied
 * the same way everywhere instead of being left to the model.
 */
export function energyGuidance(energy: Energy, restThreshold: number): string {
  if (!energy) {
    return "No energy check-in today. If the user wants to train today, you can suggest a quick check-in on the Plan tab.";
  }
  const s = energy.score;
  if (s < restThreshold) {
    return `Today's energy is ${s}%, below the user's rest threshold of ${restThreshold}%. Recommend a rest or light recovery day today (walk, mobility, stretching) rather than a hard session.`;
  }
  if (s < 50) {
    return `Today's energy is ${s}% (low). Lighten today's session: cut working sets by about a third, stop 2-3 reps short of failure, and skip optional accessories.`;
  }
  if (s < 70) {
    return `Today's energy is ${s}% (moderate). Train as planned but keep the hardest sets around RPE 7-8.`;
  }
  return `Today's energy is ${s}% (good). Train as planned.`;
}
