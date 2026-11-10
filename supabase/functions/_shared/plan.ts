import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { anthropic, FALLBACK, MODEL } from "./claude.ts";
import {
  DAY_NAMES,
  describeProfile,
  type Energy,
  energyGuidance,
  type Profile,
  today,
  weekStart,
} from "./context.ts";

const exerciseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "equipment", "sets", "reps", "rest_seconds", "target_rpe", "notes"],
  properties: {
    name: { type: "string", description: "Common gym name, e.g. 'Barbell back squat'" },
    equipment: { type: "string", description: "Machine or equipment, e.g. 'Squat rack', 'Cable machine'" },
    sets: { type: "integer" },
    reps: { type: "string", description: "Rep target, e.g. '8-10' or '5'" },
    rest_seconds: { type: "integer" },
    target_rpe: { type: "number", description: "Target effort 1-10" },
    notes: { type: "string", description: "One short cue, or empty string" },
  },
};

const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "days"],
  properties: {
    title: { type: "string", description: "Short plan name, e.g. 'Upper/Lower Hypertrophy'" },
    summary: { type: "string", description: "2-3 sentences explaining the week and how energy shaped it" },
    days: {
      type: "array",
      description: "Exactly 7 entries, day_index 0 (Monday) to 6 (Sunday)",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["day_index", "title", "focus", "is_rest", "notes", "exercises"],
        properties: {
          day_index: { type: "integer" },
          title: { type: "string" },
          focus: { type: "string" },
          is_rest: { type: "boolean" },
          notes: { type: "string" },
          exercises: { type: "array", items: exerciseSchema },
        },
      },
    },
  },
};

type GeneratedExercise = {
  name: string;
  equipment: string;
  sets: number;
  reps: string;
  rest_seconds: number;
  target_rpe: number;
  notes: string;
};
type GeneratedDay = {
  day_index: number;
  title: string;
  focus: string;
  is_rest: boolean;
  notes: string;
  exercises: GeneratedExercise[];
};
type GeneratedPlan = { title: string; summary: string; days: GeneratedDay[] };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

/** Keep the model's output inside the database's limits, and make sure all 7 days exist. */
function sanitize(plan: GeneratedPlan, maxExercises: number): GeneratedPlan {
  const byIndex = new Map<number, GeneratedDay>();
  for (const d of plan.days ?? []) {
    const i = clamp(d.day_index, 0, 6);
    if (!byIndex.has(i)) byIndex.set(i, d);
  }
  const days: GeneratedDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = byIndex.get(i);
    if (!d) {
      days.push({ day_index: i, title: "Rest", focus: "Recovery", is_rest: true, notes: "", exercises: [] });
      continue;
    }
    days.push({
      ...d,
      day_index: i,
      exercises: d.is_rest ? [] : (d.exercises ?? []).slice(0, maxExercises).map((e) => ({
        ...e,
        sets: clamp(e.sets ?? 3, 1, 20),
        rest_seconds: clamp(e.rest_seconds ?? 90, 0, 900),
        target_rpe: Math.min(10, Math.max(1, Number(e.target_rpe) || 8)),
      })),
    });
  }
  return { title: plan.title || "My week", summary: plan.summary ?? "", days };
}

/**
 * Generates a weekly plan with Claude (structured JSON output), saves it as the
 * user's active plan, and returns its id and a short summary.
 */
export async function generateAndSavePlan(
  supabase: SupabaseClient,
  profile: Profile,
  energy: Energy,
  requestNotes?: string,
): Promise<{ planId: string; title: string; summary: string }> {
  const { dayIndex } = today(profile.timezone);

  const system = [
    "You are Spotter, an expert strength and conditioning coach for people who train in a gym.",
    "Design one week of training that fits the user's goal, experience, schedule and session length.",
    "Use exercises available in a typical commercial gym. Prefer proven compound lifts, then accessories.",
    "Follow the user's preferred training split. Lay it out over their training days, repeating or rotating it if they train more days than the split has (e.g. PPL on 6 days = PPLPPL). If they have fewer days than the split needs, say so in the summary and pick the closest fit (for example upper/lower or full body). Only choose the split yourself when they have no preference.",
    "If the user set a number of exercises per session, every training day must have exactly that many exercises: no more, no fewer. Otherwise use 4-6 for most sessions (fewer for short sessions or beginners). Never pad a day with extra accessories.",
    "Respect injuries and limits: avoid or substitute movements that load an injured area.",
    "Volume and intensity must suit the experience level; beginners get simpler programs.",
    "Rest days have is_rest = true and an empty exercises list.",
    "Return exactly 7 days, day_index 0 = Monday through 6 = Sunday.",
  ].join("\n");

  const user = [
    "<profile>",
    describeProfile(profile),
    "</profile>",
    "",
    `Today is ${DAY_NAMES[dayIndex]} (day_index ${dayIndex}).`,
    `<energy>${energyGuidance(energy, profile.rest_threshold)} Apply this to today's day only; plan the rest of the week normally.</energy>`,
    requestNotes?.trim() ? `\n<user_request>${requestNotes.trim()}</user_request>` : "",
    "",
    "Create the weekly plan.",
  ].join("\n");

  const response = await anthropic.beta.messages.create({
    ...FALLBACK,
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: planSchema } },
    system,
    messages: [{ role: "user", content: user }],
  });

  if (response.stop_reason === "refusal") throw new Error("The coach could not create a plan for that request.");
  if (response.stop_reason === "max_tokens") throw new Error("The plan was cut off. Please try again.");

  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const plan = sanitize(JSON.parse(text) as GeneratedPlan, profile.exercises_per_session ?? 12);

  const { data: planId, error } = await supabase.rpc("save_weekly_plan", {
    plan: {
      week_start: weekStart(profile.timezone),
      goal: profile.goal,
      energy_score: energy?.score ?? null,
      title: plan.title,
      summary: plan.summary,
      source: "ai",
      days: plan.days,
    },
  });
  if (error) throw error;

  return { planId: planId as string, title: plan.title, summary: plan.summary };
}
