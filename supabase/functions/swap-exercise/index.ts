// Taken-machine swap.
//
// POST { "exercise_id": "<plan_exercises id>", "note"?: "all cable machines are busy too", "avoid"?: ["..."] }
//   Suggests up to 3 equivalent exercises (same muscles and movement pattern,
//   different gym equipment) for an exercise whose machine is taken.
//   The user's goal, split, injuries and the rest of the day are taken into
//   account. Nothing is saved: the app writes the one the user picks.
//   Response: { options: [{ name, equipment, reps, why, notes }] }

import { anthropic, FALLBACK, MODEL } from "../_shared/claude.ts";
import { describeProfile, loadProfile } from "../_shared/context.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { getUserContext } from "../_shared/supabase.ts";

const optionsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["options"],
  properties: {
    options: {
      type: "array",
      description: "2 or 3 alternatives, best first",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "equipment", "reps", "why", "notes"],
        properties: {
          name: { type: "string", description: "Common gym name, e.g. 'Dumbbell Romanian deadlift'" },
          equipment: { type: "string", description: "What it uses, e.g. 'Dumbbells', 'Cable machine', 'Smith machine'" },
          reps: { type: "string", description: "Rep target, usually the same as the original, e.g. '8-10'" },
          why: { type: "string", description: "One short sentence: why it is a good stand-in" },
          notes: { type: "string", description: "One short form cue, or empty string" },
        },
      },
    },
  },
};

type Option = { name: string; equipment: string; reps: string; why: string; notes: string };

type ExerciseRow = {
  id: string;
  name: string;
  equipment: string | null;
  sets: number;
  reps: string;
  notes: string | null;
  swapped_from: { name?: string; equipment?: string | null } | null;
  plan_days: {
    title: string;
    focus: string | null;
    plan_exercises: { id: string; name: string; equipment: string | null; position: number }[];
  } | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const ctx = await getUserContext(req);
  if (!ctx) return json({ error: "Not signed in" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const exerciseId = typeof body.exercise_id === "string" ? body.exercise_id : "";
  if (!exerciseId) return json({ error: "Which exercise?" }, 400);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
  const avoid = (Array.isArray(body.avoid) ? body.avoid : [])
    .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
    .map((a) => a.trim().slice(0, 80))
    .slice(0, 12);

  try {
    // Row-level security means this only finds the user's own exercise.
    const { data, error } = await ctx.supabase
      .from("plan_exercises")
      .select("id, name, equipment, sets, reps, notes, swapped_from, plan_days(title, focus, plan_exercises(id, name, equipment, position))")
      .eq("id", exerciseId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return json({ error: "That exercise is no longer in your plan" }, 404);
    const ex = data as unknown as ExerciseRow;
    const profile = await loadProfile(ctx.supabase, ctx.user.id);

    const others = [...(ex.plan_days?.plan_exercises ?? [])]
      .filter((e) => e.id !== ex.id)
      .sort((a, b) => a.position - b.position)
      .map((e) => `- ${e.name}${e.equipment ? ` (${e.equipment})` : ""}`);
    const original = ex.swapped_from?.name
      ? `${ex.swapped_from.name}${ex.swapped_from.equipment ? ` (${ex.swapped_from.equipment})` : ""}`
      : null;

    const system = [
      "You are Spotter, an expert strength coach. The user is mid-workout in a commercial gym and the machine or equipment for one exercise is taken.",
      "Suggest 2 or 3 equivalent exercises they can do right now instead, best first.",
      "Each one must train the same main muscles with the same movement pattern (e.g. horizontal push, vertical pull, hip hinge, squat, knee extension), so the day still fits the user's training split and goal.",
      "Each one must use different equipment from the taken one, and ideally the options use different equipment from each other (e.g. dumbbells, a cable station, a Smith machine, a different machine) so at least one is likely free.",
      "Only suggest equipment found in a typical commercial gym. Do not repeat an exercise that is already in today's session.",
      "Respect the user's injuries and experience: beginners get simple, stable movements.",
      "Keep the rep target the same as the original unless the new movement clearly needs a different range (e.g. a less stable dumbbell version may suit slightly higher reps).",
    ].join("\n");

    const user = [
      "<profile>",
      describeProfile(profile),
      "</profile>",
      "",
      `Today's session: ${ex.plan_days?.title ?? "Workout"}${ex.plan_days?.focus ? ` (${ex.plan_days.focus})` : ""}`,
      others.length ? `Other exercises today:\n${others.join("\n")}` : "",
      "",
      `Exercise to replace: ${ex.name}${ex.equipment ? ` on/with: ${ex.equipment}` : ""}, ${ex.sets} sets of ${ex.reps}.`,
      original ? `It was itself a swap for: ${original}. Keep the same muscles and pattern as that original.` : "",
      `Taken: ${ex.equipment || ex.name}.`,
      avoid.length ? `Also don't suggest these (already offered or not available): ${avoid.join(", ")}` : "",
      note ? `<user_note>${note}</user_note>` : "",
    ].filter(Boolean).join("\n");

    const response = await anthropic.beta.messages.create({
      ...FALLBACK,
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low", format: { type: "json_schema", schema: optionsSchema } },
      system,
      messages: [{ role: "user", content: user }],
    });
    if (response.stop_reason === "refusal") return json({ error: "The coach couldn't suggest a swap for that." }, 422);

    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const parsed = JSON.parse(text) as { options: Option[] };
    const seen = new Set((ex.plan_days?.plan_exercises ?? []).map((e) => e.name.trim().toLowerCase()));
    seen.add(ex.name.trim().toLowerCase());
    const options = (parsed.options ?? [])
      .map((o) => ({
        name: String(o.name ?? "").trim().slice(0, 80),
        equipment: String(o.equipment ?? "").trim().slice(0, 80),
        reps: String(o.reps ?? "").trim().slice(0, 30) || ex.reps,
        why: String(o.why ?? "").trim(),
        notes: String(o.notes ?? "").trim(),
      }))
      .filter((o) => o.name && !seen.has(o.name.toLowerCase()))
      .slice(0, 3);
    if (!options.length) return json({ error: "No good swap found. Try again or describe what's free." }, 422);
    return json({ options });
  } catch (err) {
    console.error("swap-exercise failed", err);
    return json({ error: "Could not reach the coach right now. Please try again." }, 500);
  }
});
