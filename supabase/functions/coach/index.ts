// Spotter AI coach: streams a reply to the user's chat message.
//
// Request:  POST { "message": "..." }  (Authorization: Bearer <user access token>)
// Response: newline-delimited JSON events
//   {"type":"text","text":"..."}      a piece of the reply, in order
//   {"type":"plan","planId":"...","title":"..."}   the coach created a new weekly plan
//   {"type":"done"}
//   {"type":"error","message":"..."}
//
// Chat history is stored server-side in chat_messages; the client only sends the new message.

import type Anthropic from "npm:@anthropic-ai/sdk@1";
import { anthropic, FALLBACK, MODEL } from "../_shared/claude.ts";
import {
  DAY_NAMES,
  describeActivePlan,
  describeNutrition,
  describeProfile,
  describeRecentFormChecks,
  describeRecentWorkouts,
  energyGuidance,
  loadProfile,
  loadRecentEnergy,
  loadTodayNutrition,
  today,
} from "../_shared/context.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { generateAndSavePlan } from "../_shared/plan.ts";
import { getUserContext } from "../_shared/supabase.ts";

const HISTORY_LIMIT = 30;
const MAX_TOOL_ROUNDS = 2;

const SYSTEM = `You are Spotter, a friendly, knowledgeable AI fitness coach inside a mobile app for people who train in a gym.

How you coach:
- Be concise and practical. This is a phone chat: short paragraphs, simple lists, no long essays.
- Base advice on the user's profile, today's energy and their current plan, given below.
- Give specific numbers (sets, reps, rest, RPE) when it helps.
- Respect injuries and limits. For pain, injury or medical questions, give general guidance and recommend a qualified professional.
- You are not a doctor or dietitian; do not diagnose.
- You can see what they ate today versus their calorie and protein targets, their recent logged workouts and their latest form check feedback. Use them: suggest food that fills today's protein gap, recommend going heavier when they hit the top of their rep range, and remind them of form cues from their checks.
- If they are over a target today (marked OVER in food_today), mention it once when food or training comes up, kindly and without guilt: one day doesn't undo progress, suggest keeping the rest of the day light and getting back on plan tomorrow. Going over on protein is generally fine.
- Food is logged by photo on the Eat tab. Form checks are filmed from the workout screen (tap "Check form" on an exercise).

Weekly plans:
- When the user asks for a new plan, a plan change that needs a new week, or has no plan yet and wants one, call create_weekly_plan.
- Plans follow the split in their profile. If they ask for a different split just for this week, put it in "notes". If they want to change it for good, tell them they can change it on the Profile tab.
- Plans use the number of exercises per session from their profile. When you suggest a workout in chat, stick to that number too.
- Pass their specific requests in "notes" (for example "no leg day Friday" or "add more arm work").
- After the tool returns, briefly tell them what the week looks like and that they can edit any day on the Plan tab.
- For small tweaks to one exercise, tell them they can edit it directly on the Plan tab instead of regenerating the week.`;

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: "create_weekly_plan",
    description:
      "Create a new 7-day workout plan for the user based on their profile, goal and today's energy, and save it as their active plan (replacing the current one). Returns the plan title and summary.",
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["notes"],
      properties: {
        notes: {
          type: "string",
          description: "The user's specific requests for this plan, or an empty string.",
        },
      },
    },
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const ctx = await getUserContext(req);
  if (!ctx) return json({ error: "Not signed in" }, 401);
  const { supabase, user } = ctx;

  let message: string;
  try {
    const body = await req.json();
    message = String(body?.message ?? "").trim();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!message) return json({ error: "Message is empty" }, 400);
  if (message.length > 4000) return json({ error: "Message is too long" }, 400);

  // Load context before streaming so setup errors return a normal HTTP error.
  const profile = await loadProfile(supabase, user.id);
  const [energy, planText, nutrition, workoutsText, formText, historyRes] = await Promise.all([
    loadRecentEnergy(supabase),
    describeActivePlan(supabase),
    loadTodayNutrition(supabase, profile.timezone),
    describeRecentWorkouts(supabase),
    describeRecentFormChecks(supabase),
    supabase
      .from("chat_messages")
      .select("role, content")
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
  ]);

  const { error: insertError } = await supabase
    .from("chat_messages")
    .insert({ role: "user", content: message });
  if (insertError) return json({ error: insertError.message }, 500);

  // History arrives newest first; the API needs oldest first, starting with a user turn.
  const history = [...(historyRes.data ?? [])].reverse() as { role: "user" | "assistant"; content: string }[];
  while (history.length && history[0].role !== "user") history.shift();

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  const { dayIndex } = today(profile.timezone);
  const context = [
    "<user_profile>",
    describeProfile(profile),
    "</user_profile>",
    `<today>${DAY_NAMES[dayIndex]}. ${energyGuidance(energy, profile.rest_threshold)}</today>`,
    `<current_plan>${planText ?? "No plan yet."}</current_plan>`,
    `<food_today>\n${describeNutrition(profile, nutrition)}\n</food_today>`,
    `<recent_workouts>\n${workoutsText ?? "No workouts logged yet."}\n</recent_workouts>`,
    `<recent_form_checks>\n${formText ?? "No form checks yet."}\n</recent_form_checks>`,
  ].join("\n");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      let replyText = "";
      let createdPlanId: string | null = null;

      try {
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          const turn = anthropic.beta.messages.stream({
            ...FALLBACK,
            model: MODEL,
            max_tokens: 64000,
            output_config: { effort: "low" },
            // Stable instructions first, per-user context second.
            system: [
              { type: "text", text: SYSTEM },
              { type: "text", text: context },
            ],
            tools,
            messages,
          });

          for await (const event of turn) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              replyText += event.delta.text;
              send({ type: "text", text: event.delta.text });
            }
          }

          const final = await turn.finalMessage();
          messages.push({ role: "assistant", content: final.content });

          if (final.stop_reason === "refusal") {
            const note = "\n\nSorry, I can't help with that one. Ask me anything about your training.";
            replyText += note;
            send({ type: "text", text: note });
            break;
          }
          if (final.stop_reason !== "tool_use" || round === MAX_TOOL_ROUNDS) break;

          const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
          for (const block of final.content) {
            if (block.type !== "tool_use") continue;
            if (block.name !== "create_weekly_plan") {
              results.push({ type: "tool_result", tool_use_id: block.id, content: "Unknown tool", is_error: true });
              continue;
            }
            const input = block.input as { notes?: unknown };
            const notes = typeof input?.notes === "string" ? input.notes : "";
            try {
              if (replyText && !replyText.endsWith("\n")) {
                replyText += "\n\n";
                send({ type: "text", text: "\n\n" });
              }
              send({ type: "status", text: "Building your week…" });
              const plan = await generateAndSavePlan(supabase, profile, energy, notes);
              createdPlanId = plan.planId;
              send({ type: "plan", planId: plan.planId, title: plan.title });
              results.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify({ saved: true, title: plan.title, summary: plan.summary }),
              });
            } catch (err) {
              console.error("create_weekly_plan failed", err);
              results.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: "Plan generation failed. Apologise briefly and suggest trying again from the Plan tab.",
                is_error: true,
              });
            }
          }
          messages.push({ role: "user", content: results });
        }

        if (replyText.trim()) {
          await supabase
            .from("chat_messages")
            .insert({ role: "assistant", content: replyText.trim(), plan_id: createdPlanId });
        }
        send({ type: "done" });
      } catch (err) {
        console.error("coach stream failed", err);
        send({ type: "error", message: "The coach is unavailable right now. Please try again." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
});
