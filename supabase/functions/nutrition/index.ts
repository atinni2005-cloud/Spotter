// Food features for the Eat tab.
//
// POST { "action": "analyze", "image_base64"?: "...", "description"?: "..." }
//   Estimates calories and macros from a food photo and/or a description.
//   Nothing is saved: the app shows the estimate, the user can edit it, then saves it.
//   Response: { name, items: [...], calories, protein_g, carbs_g, fat_g, confidence, note }
//
// POST { "action": "suggest" }
//   Suggests one meal that fills the gap between what the user ate today and their targets.
//   Response: { remaining: {calories, protein_g}, met: boolean, suggestion: {title, description, calories, protein_g} | null }

import type Anthropic from "npm:@anthropic-ai/sdk@1";
import { anthropic, FALLBACK, MODEL } from "../_shared/claude.ts";
import { describeNutrition, GOAL_LABEL, loadProfile, loadTodayNutrition, type Profile } from "../_shared/context.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { getUserContext } from "../_shared/supabase.ts";

const MAX_IMAGE_BASE64 = 6_000_000;

const estimateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["is_food", "name", "items", "confidence", "note"],
  properties: {
    is_food: { type: "boolean", description: "false if the photo does not show food or drink" },
    name: { type: "string", description: "Short meal name, e.g. 'Chicken rice bowl'" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "portion", "calories", "protein_g", "carbs_g", "fat_g"],
        properties: {
          name: { type: "string" },
          portion: { type: "string", description: "Estimated amount, e.g. '150 g' or '1 cup'" },
          calories: { type: "number" },
          protein_g: { type: "number" },
          carbs_g: { type: "number" },
          fat_g: { type: "number" },
        },
      },
    },
    confidence: { type: "number", description: "0 to 1: how confident the estimate is" },
    note: { type: "string", description: "One short sentence on what could make the estimate off, or empty" },
  },
};

const suggestionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "calories", "protein_g"],
  properties: {
    title: { type: "string", description: "Short meal name, max 40 characters" },
    description: { type: "string", description: "One sentence: what to eat and roughly how much" },
    calories: { type: "number" },
    protein_g: { type: "number" },
  },
};

async function structured<T>(
  system: string,
  content: Anthropic.Beta.BetaContentBlockParam[],
  schema: Record<string, unknown>,
): Promise<T> {
  const response = await anthropic.beta.messages.create({
    ...FALLBACK,
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") throw new Error("refused");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return JSON.parse(text) as T;
}

type Item = { name: string; portion: string; calories: number; protein_g: number; carbs_g: number; fat_g: number };
type Estimate = { is_food: boolean; name: string; items: Item[]; confidence: number; note: string };

async function analyze(body: Record<string, unknown>) {
  const image = typeof body.image_base64 === "string" ? body.image_base64 : "";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 1000) : "";
  if (!image && !description) return json({ error: "Add a photo or describe the meal" }, 400);
  if (image.length > MAX_IMAGE_BASE64) return json({ error: "That photo is too large" }, 400);

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } });
  content.push({
    type: "text",
    text: description
      ? `${image ? "The user adds: " : "The user describes their meal: "}${description}`
      : "Estimate this meal.",
  });

  const est = await structured<Estimate>(
    [
      "You are a sports nutritionist estimating the calories and macros of a meal for a gym-goer's food log.",
      "List each visible food item with an estimated portion and its calories, protein, carbs and fat.",
      "Use typical restaurant or home portions, and account for visible oil, sauces and dressings.",
      "If the user gives amounts or details, trust them over what you see.",
      "Round calories to the nearest 5 and grams to whole numbers.",
      "If the image is not food, set is_food to false and return an empty items list.",
    ].join("\n"),
    content,
    estimateSchema,
  );

  if (!est.is_food) return json({ error: "That doesn't look like food. Try another photo, or describe the meal." }, 422);
  const items = (est.items ?? []).map((i) => ({
    name: i.name,
    portion: i.portion,
    calories: Math.max(0, Math.round(i.calories)),
    protein_g: Math.max(0, Math.round(i.protein_g)),
    carbs_g: Math.max(0, Math.round(i.carbs_g)),
    fat_g: Math.max(0, Math.round(i.fat_g)),
  }));
  const total = (k: keyof Omit<Item, "name" | "portion">) => items.reduce((t, i) => t + i[k], 0);
  return json({
    name: est.name || "Meal",
    items,
    calories: total("calories"),
    protein_g: total("protein_g"),
    carbs_g: total("carbs_g"),
    fat_g: total("fat_g"),
    confidence: Math.min(1, Math.max(0, Number(est.confidence) || 0.5)),
    note: est.note ?? "",
  });
}

// A day counts as "on target" when protein is within 15 g and calories within 200 kcal.
const PROTEIN_SLACK = 15;
const CALORIE_SLACK = 200;

async function suggest(profile: Profile, supabase: Parameters<typeof loadTodayNutrition>[0]) {
  const day = await loadTodayNutrition(supabase, profile.timezone);
  const remaining = {
    calories: profile.calorie_target ? Math.max(0, profile.calorie_target - day.calories) : null,
    protein_g: profile.protein_target_g ? Math.max(0, profile.protein_target_g - day.protein_g) : null,
  };
  const met =
    (remaining.calories === null || remaining.calories <= CALORIE_SLACK) &&
    (remaining.protein_g === null || remaining.protein_g <= PROTEIN_SLACK);
  if (met) return json({ remaining, met: true, suggestion: null });

  const suggestion = await structured<{ title: string; description: string; calories: number; protein_g: number }>(
    [
      "You are a sports nutritionist. Suggest ONE simple meal or snack the user can make or buy this evening that closes the gap to their daily targets.",
      "Prioritise hitting protein. Stay at or under the remaining calories. Use everyday foods, give rough amounts, and keep it realistic for one sitting (max about 70 g protein).",
      `The user's goal is to ${profile.goal ? GOAL_LABEL[profile.goal] : "stay fit"}.`,
    ].join("\n"),
    [
      {
        type: "text",
        text: `<today>\n${describeNutrition(profile, day)}\n</today>\nRemaining: ${remaining.calories ?? "?"} kcal, ${remaining.protein_g ?? "?"} g protein.`,
      },
    ],
    suggestionSchema,
  );
  return json({
    remaining,
    met: false,
    suggestion: {
      title: suggestion.title,
      description: suggestion.description,
      calories: Math.round(suggestion.calories),
      protein_g: Math.round(suggestion.protein_g),
    },
  });
}

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

  try {
    if (body.action === "analyze") return await analyze(body);
    if (body.action === "suggest") {
      const profile = await loadProfile(ctx.supabase, ctx.user.id);
      return await suggest(profile, ctx.supabase);
    }
    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("nutrition failed", err);
    return json({ error: "Could not reach the coach right now. Please try again." }, 500);
  }
});
