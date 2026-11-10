// Food features for the Eat tab.
//
// POST { "action": "analyze", "image_base64"?: "...", "description"?: "..." }
//   Estimates calories and macros from a food photo and/or a description.
//   Nothing is saved: the app shows the estimate, the user can edit it, then saves it.
//   Response: { name, items: [...], calories, protein_g, carbs_g, fat_g, confidence, note }
//
// POST { "action": "suggest" }
//   Suggests one meal that fills the gap between what the user ate today and their targets.
//   Response: { remaining: {calories, protein_g}, over: {calories, protein_g, carbs_g, fat_g}, met: boolean,
//               suggestion: <recipe> | null }
//   <recipe> = { title, description, calories, protein_g, carbs_g, fat_g, prep_minutes, cook_minutes,
//                servings, ingredients: [{name, amount}], steps: ["..."] }
//
// POST { "action": "swap", "meal": <suggestion>, "missing": ["Greek yogurt", ...], "note"?: "..." }
//   Replaces the ingredients the user doesn't have with equivalents that keep
//   the meal close to the same calories and protein.
//   The recipe's amounts, steps, times and macros are updated to match.
//   Response: { suggestion: <recipe>, swaps: [{from, to}] }

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

const ingredientSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "amount"],
  properties: {
    name: { type: "string", description: "Plain ingredient name, e.g. 'Greek yogurt'" },
    amount: {
      type: "string",
      description: "Exact amount for the recipe, in grams or ml where it makes sense, e.g. '200 g', '1 tbsp (15 ml)', '2 large eggs'",
    },
  },
};

const suggestionProperties = {
  title: { type: "string", description: "Short recipe name, max 40 characters" },
  description: { type: "string", description: "One sentence on what it is and why it fits today" },
  calories: { type: "number", description: "Total for the whole recipe" },
  protein_g: { type: "number" },
  carbs_g: { type: "number" },
  fat_g: { type: "number" },
  prep_minutes: { type: "integer", description: "Hands-on prep time in minutes" },
  cook_minutes: { type: "integer", description: "Cooking time in minutes, 0 if no cooking" },
  servings: { type: "integer", description: "Usually 1" },
  ingredients: { type: "array", items: ingredientSchema, description: "Every ingredient incl. oil and seasoning, 2 to 12 items" },
  steps: {
    type: "array",
    items: { type: "string" },
    description: "Numbered cooking steps in order, 2 to 8, each one short sentence or two with times and heat where relevant. No step numbers in the text.",
  },
};

const suggestionSchema = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(suggestionProperties),
  properties: suggestionProperties,
};

const swapSchema = {
  type: "object",
  additionalProperties: false,
  required: ["meal", "swaps"],
  properties: {
    meal: suggestionSchema,
    swaps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to"],
        properties: {
          from: { type: "string", description: "The missing ingredient" },
          to: { type: "string", description: "What replaces it, with amount, or 'left out'" },
        },
      },
    },
  },
};

type Ingredient = { name: string; amount: string };
type Suggestion = {
  title: string;
  description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  prep_minutes: number;
  cook_minutes: number;
  servings: number;
  ingredients: Ingredient[];
  steps: string[];
};

const whole = (n: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));

function cleanSuggestion(s: Partial<Suggestion>): Suggestion {
  return {
    title: String(s.title ?? "Meal").slice(0, 80),
    description: String(s.description ?? ""),
    calories: whole(s.calories, 0, 5000),
    protein_g: whole(s.protein_g, 0, 500),
    carbs_g: whole(s.carbs_g, 0, 1000),
    fat_g: whole(s.fat_g, 0, 500),
    prep_minutes: whole(s.prep_minutes, 0, 600),
    cook_minutes: whole(s.cook_minutes, 0, 600),
    servings: whole(s.servings ?? 1, 1, 20),
    ingredients: (Array.isArray(s.ingredients) ? s.ingredients : [])
      .slice(0, 14)
      .map((i) => ({ name: String(i.name), amount: String(i.amount ?? "") })),
    steps: (Array.isArray(s.steps) ? s.steps : [])
      .map((x) => String(x).trim().replace(/^\d+[.)]\s*/, ""))
      .filter(Boolean)
      .slice(0, 12),
  };
}

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
  const over = {
    calories: profile.calorie_target ? Math.max(0, day.calories - profile.calorie_target) : 0,
    protein_g: profile.protein_target_g ? Math.max(0, day.protein_g - profile.protein_target_g) : 0,
    carbs_g: profile.carbs_target_g ? Math.max(0, day.carbs_g - profile.carbs_target_g) : 0,
    fat_g: profile.fat_target_g ? Math.max(0, day.fat_g - profile.fat_target_g) : 0,
  };
  const met =
    (remaining.calories === null || remaining.calories <= CALORIE_SLACK) &&
    (remaining.protein_g === null || remaining.protein_g <= PROTEIN_SLACK);
  if (met) return json({ remaining, over, met: true, suggestion: null });

  const suggestion = await structured<Suggestion>(
    [
      "You are a sports nutritionist and home cook. Give ONE simple recipe for a meal or snack the user can make this evening that closes the gap to their daily targets.",
      "Prioritise hitting protein. Stay at or under the remaining calories; if they are already at or over their calories, suggest a very light, lean, high-protein option. Use everyday supermarket foods and keep it realistic for one sitting (max about 70 g protein).",
      "Write it as a full recipe for one serving: exact ingredient amounts (grams or ml where sensible, including cooking oil), short step-by-step instructions with times and heat, prep and cook time, and macros (calories, protein, carbs, fat) that add up from the ingredient amounts. Keep the total time under about 30 minutes unless no cooking is needed.",
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
    over,
    met: false,
    suggestion: cleanSuggestion(suggestion),
  });
}

async function swap(body: Record<string, unknown>) {
  // deno-lint-ignore no-explicit-any
  const meal = body.meal as any;
  const missing = (Array.isArray(body.missing) ? body.missing : [])
    .filter((m): m is string => typeof m === "string" && m.trim().length > 0)
    .map((m) => m.trim().slice(0, 80))
    .slice(0, 10);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
  if (!meal || typeof meal.title !== "string" || !Array.isArray(meal.ingredients)) {
    return json({ error: "No meal to change" }, 400);
  }
  if (!missing.length && !note) return json({ error: "Tap the ingredients you don't have" }, 400);
  const current = cleanSuggestion(meal as Suggestion);

  const result = await structured<{ meal: Suggestion; swaps: { from: string; to: string }[] }>(
    [
      "You are a sports nutritionist adjusting a meal because the user is missing some ingredients.",
      "Replace each missing ingredient with a common, easy-to-find equivalent that plays the same role (protein source for protein source, carb for carb), adjusting amounts so the meal stays within about 10% of the original calories and protein.",
      "Keep every ingredient the user has. Never re-add a missing ingredient. If an ingredient is minor (a garnish or spice), you may simply leave it out.",
      "Update the title, description, ingredient amounts, cooking steps, prep and cook time, and macros (calories, protein, carbs, fat) to match the new recipe, and list each swap.",
    ].join("\n"),
    [
      {
        type: "text",
        text: [
          `<meal>${JSON.stringify(current)}</meal>`,
          missing.length ? `Missing: ${missing.join(", ")}` : "",
          note ? `The user adds: ${note}` : "",
        ].filter(Boolean).join("\n"),
      },
    ],
    swapSchema,
  );
  return json({
    suggestion: cleanSuggestion(result.meal),
    swaps: (result.swaps ?? []).map((x) => ({ from: String(x.from), to: String(x.to) })),
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
    if (body.action === "swap") return await swap(body);
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
