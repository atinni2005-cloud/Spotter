// Spotter AI coach: streams a reply to the user's chat message.
//
// Request:  POST { "message": "..." }  (Authorization: Bearer <user access token>)
// Response: newline-delimited JSON events
//   {"type":"text","text":"..."}      a piece of the reply, in order
//   {"type":"status","text":"..."}    what the coach is doing (e.g. building a plan)
//   {"type":"plan","planId":"...","title":"..."}   the coach created a new weekly plan
//   {"type":"suggestions","replies":["...","..."]} quick replies the user can tap
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

const HISTORY_LIMIT = 40;
const MAX_TOOL_ROUNDS = 2;

const SYSTEM = `You are Spotter, the user's personal fitness coach inside a gym app. Talk like a real coach and a friend who happens to know a lot about training, nutrition and recovery: warm, curious, honest and a little bit fun.

How to talk:
- This is a real, free-flowing conversation, not a support ticket. Answer what they actually asked, react to what they say, and keep the thread going naturally.
- Remember the conversation so far and build on it. Refer back to things they told you earlier ("how did that shoulder feel after Tuesday?").
- Ask a short follow-up question when it genuinely helps: to understand their situation before giving advice, or to keep the chat going. One question at a time, not a questionnaire.
- Offer ideas and suggestions proactively when they fit ("want me to give you a quick 20-minute version?"), but don't push.
- Match their energy and length. A quick "thanks!" or "lol" gets a short, friendly reply. A big question gets a proper answer.
- Phone chat: short paragraphs, simple bullet lists when listing things, **bold** for the key point. No headings, no tables, no long essays.
- Be honest. If something is a myth, say so kindly and explain why. If the science is mixed, say that.

What you can talk about:
- Anything to do with fitness and health habits: training technique, programming, progressive overload, cardio, mobility, sports, motivation, plateaus, gym anxiety, sleep, stress, recovery, soreness, hydration, supplements (evidence-based), nutrition, recipes, meal prep, eating out, travel workouts, home workouts.
- Small talk is fine. If they go fully off-topic, chat briefly and kindly, then gently bring it back to how you can help.
- You are not a doctor or dietitian and do not diagnose. For pain, injury, medication or medical conditions, give sensible general guidance and recommend a qualified professional, without lecturing.

Using what you know about them (given below):
- You can see their profile, today's energy, their current weekly plan, what they ate today versus their targets, their recent logged workouts and their latest form check feedback.
- Use it the way a good coach would: when it's relevant to what they're asking, not in every reply. Don't bring up the weekly plan unless the conversation is about training, scheduling or the plan itself.
- When it is relevant, be specific: give numbers (sets, reps, rest, RPE, grams of protein), suggest food that fills today's protein gap, suggest going heavier when they hit the top of their rep range, remind them of form cues from their checks.
- If they are over a calorie or carb/fat target today (marked OVER in food_today), mention it once when food comes up, kindly and without guilt: one day doesn't undo progress. Going over on protein is fine.
- Respect injuries and limits from their profile in every suggestion.

App features you can point to (only when useful):
- Food is logged by photo on the Eat tab, which also has meal ideas and full recipes.
- Form checks are filmed from the workout screen (tap "Check form" on an exercise).
- On the Plan tab they can edit any day, do the daily energy check-in, and swap an exercise when a machine is taken.
- Training split, days and targets are changed on the Profile tab.

Weekly plans (a tool, not the main topic):
- Call create_weekly_plan only when the user clearly asks for a new plan or a new week, or has no plan and says yes to you building one. Never create one just because training came up. If you're not sure they want a new week, ask first.
- Plans follow the split in their profile. If they want a different split just for this week, put it in "notes". If they want to change it for good, point them to the Profile tab.
- Plans and any workout you suggest in chat use the number of exercises per session from their profile.
- Pass their specific requests in "notes" (for example "no leg day Friday" or "add more arm work").
- After the tool returns, briefly tell them what the week looks like and that they can edit any day on the Plan tab.
- For small tweaks to one exercise, tell them they can edit it on the Plan tab instead of regenerating the week.`;

const SUGGEST_SYSTEM = `You write the quick-reply buttons shown under a fitness coach's latest chat message.
Write 3 short things the USER would naturally tap to reply next, in the user's own voice (first person), based on the conversation.
- If the coach asked a question, make them plausible answers to it.
- Otherwise, make them natural follow-ups: a deeper question, a related idea, or a practical next step.
- Each one at most 6 words. No emoji. No numbering. Make them different from each other.`;

const suggestionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["replies"],
  properties: {
    replies: { type: "array", items: { type: "string" } },
  },
};

/** Short tap-to-send replies for the latest coach message. Best effort: returns [] on any problem. */
async function suggestReplies(
  history: { role: "user" | "assistant"; content: string }[],
): Promise<string[]> {
  try {
    const transcript = history
      .slice(-6)
      .map((m) => `${m.role === "user" ? "User" : "Coach"}: ${m.content.slice(0, 1500)}`)
      .join("\n\n");
    const response = await anthropic.beta.messages.create({
      ...FALLBACK,
      model: MODEL,
      max_tokens: 1000,
      output_config: { effort: "low", format: { type: "json_schema", schema: suggestionSchema } },
      system: SUGGEST_SYSTEM,
      messages: [{ role: "user", content: `<conversation>\n${transcript}\n</conversation>` }],
    });
    if (response.stop_reason !== "end_turn") return [];
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const parsed = JSON.parse(text) as { replies?: unknown };
    if (!Array.isArray(parsed.replies)) return [];
    return parsed.replies
      .map((r) => String(r ?? "").trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 3);
  } catch (err) {
    console.error("suggestReplies failed", err);
    return [];
  }
}

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

  const { date, dayIndex } = today(profile.timezone);
  const localTime = (() => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: profile.timezone, hour: "numeric", minute: "2-digit" }).format(new Date());
    } catch {
      return null;
    }
  })();
  const context = [
    "<user_profile>",
    describeProfile(profile),
    "</user_profile>",
    `<today>${DAY_NAMES[dayIndex]} ${date}${localTime ? `, ${localTime} their time` : ""}. ${energyGuidance(energy, profile.rest_threshold)}</today>`,
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
            output_config: { effort: "medium" },
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
            const note = "\n\nSorry, I can't help with that one. Ask me anything else about training, food or recovery.";
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
        // The reply is complete: unlock the chat now, then send quick replies when they're ready.
        send({ type: "done" });
        if (replyText.trim()) {
          const replies = await suggestReplies([
            ...history,
            { role: "user", content: message },
            { role: "assistant", content: replyText.trim() },
          ]);
          if (replies.length) send({ type: "suggestions", replies });
        }
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
