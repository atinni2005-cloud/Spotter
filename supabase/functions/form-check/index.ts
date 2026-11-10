// Form check: the user films their first set, the app uploads the video and
// sends still frames from it here. Feedback is written to the form_checks row
// in the background, so the app can show "analysing" and come back later.
//
// Request: POST {
//   "exercise_name": "Barbell back squat",
//   "video_path": "<user id>/<file>.mp4",        // in the form-videos bucket
//   "frames": [{ "t": 0.0, "data": "<base64 jpeg>" }, ...],   // 4-12 frames, in order
//   "duration_s"?: 32.5, "set_log_id"?: "...", "notes"?: "felt it in my lower back"
// }
// Response: { "id": "<form check id>" }  (status becomes "done" or "failed" a bit later)

import type Anthropic from "npm:@anthropic-ai/sdk@1";
import { anthropic, FALLBACK, MODEL } from "../_shared/claude.ts";
import { energyGuidance, loadProfile, loadRecentEnergy } from "../_shared/context.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { getUserContext } from "../_shared/supabase.ts";

const MAX_FRAMES = 12;
const MAX_FRAME_BASE64 = 1_500_000;

const feedbackSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "headline", "rep_count", "went_well", "fixes", "safety", "next_set", "camera_tip"],
  properties: {
    verdict: {
      type: "string",
      enum: ["good", "minor_fixes", "needs_work", "unclear"],
      description: "unclear = the frames don't show the lift well enough to judge",
    },
    headline: { type: "string", description: "One short sentence summary, max 90 characters" },
    rep_count: { type: "integer", description: "Reps you can count, or 0 if you can't tell" },
    went_well: { type: "array", items: { type: "string" }, description: "1-3 short points" },
    fixes: {
      type: "array",
      description: "Most important first, max 3",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["issue", "why", "cue"],
        properties: {
          issue: { type: "string", description: "What you saw, e.g. 'Knees cave in at the bottom'" },
          why: { type: "string", description: "Why it matters, one sentence" },
          cue: { type: "string", description: "A short coaching cue to fix it, e.g. 'Push your knees out over your toes'" },
        },
      },
    },
    safety: { type: "string", description: "A safety warning if you saw real injury risk, otherwise empty" },
    next_set: {
      type: "string",
      description: "What to do on the next sets: keep, lower or raise the weight, and how many reps, given form and today's energy",
    },
    camera_tip: { type: "string", description: "How to film it better next time, or empty if the angle was fine" },
  },
};

type Frame = { t: number; data: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const ctx = await getUserContext(req);
  if (!ctx) return json({ error: "Not signed in" }, 401);
  const { supabase, user } = ctx;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const exercise = String(body.exercise_name ?? "").trim().slice(0, 120);
  const videoPath = String(body.video_path ?? "");
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";
  const duration = Number(body.duration_s) || null;
  const setLogId = typeof body.set_log_id === "string" ? body.set_log_id : null;
  const frames = (Array.isArray(body.frames) ? body.frames : [])
    .filter((f): f is Frame => typeof f?.data === "string" && f.data.length < MAX_FRAME_BASE64)
    .slice(0, MAX_FRAMES);

  if (!exercise) return json({ error: "Which exercise is this?" }, 400);
  if (!videoPath.startsWith(`${user.id}/`)) return json({ error: "Upload the video first" }, 400);
  if (frames.length < 3) return json({ error: "Could not read the video. Try filming again." }, 400);

  const { data: row, error } = await supabase
    .from("form_checks")
    .insert({ exercise_name: exercise, video_path: videoPath, set_log_id: setLogId, status: "processing" })
    .select("id")
    .single();
  if (error || !row) return json({ error: error?.message ?? "Could not save" }, 500);

  const analyse = async () => {
    try {
      const [profile, energy] = await Promise.all([loadProfile(supabase, user.id), loadRecentEnergy(supabase)]);

      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      frames.forEach((f, i) => {
        content.push({ type: "text", text: `Frame ${i + 1} of ${frames.length}, at ${Number(f.t).toFixed(1)} s:` });
        content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: f.data } });
      });
      content.push({
        type: "text",
        text: [
          `Exercise: ${exercise}.`,
          duration ? `The video is ${duration.toFixed(0)} seconds long; these frames are spread evenly across it.` : "",
          `Lifter: ${profile.experience ?? "unknown"} level. Injuries or limits: ${profile.injuries?.trim() || "none reported"}.`,
          `Today: ${energyGuidance(energy, profile.rest_threshold)}`,
          notes ? `The lifter says: ${notes}` : "",
          "Review this set's form.",
        ].filter(Boolean).join("\n"),
      });

      const response = await anthropic.beta.messages.create({
        ...FALLBACK,
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: "medium", format: { type: "json_schema", schema: feedbackSchema } },
        system: [
          "You are Spotter, an experienced strength coach reviewing a gym-goer's video of their first working set.",
          "You see still frames taken at even intervals from the video, in order. Judge the movement from what is visible: setup, range of motion, joint positions, bar or handle path, tempo and control across reps.",
          "Be honest but encouraging. Only mention problems you can actually see; never invent them. If the angle or framing hides something important, say so in camera_tip and set verdict to 'unclear' when you can't judge the lift at all.",
          "Give at most 3 fixes, most important first, each with a short cue the lifter can think about mid-set.",
          "Use next_set to tell them whether to keep, lower or raise the weight and how many reps, taking today's energy into account.",
          "You are not a doctor. If something looks risky for an injury they reported, recommend checking with a physio.",
        ].join("\n"),
        messages: [{ role: "user", content }],
      });

      if (response.stop_reason === "refusal") throw new Error("refused");
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const feedback = JSON.parse(text);
      await supabase.from("form_checks").update({ status: "done", feedback }).eq("id", row.id);
    } catch (err) {
      console.error("form-check analysis failed", err);
      await supabase
        .from("form_checks")
        .update({ status: "failed", feedback: { error: "The coach couldn't review this video. Please try again." } })
        .eq("id", row.id);
    }
  };

  // Keep working after the response is sent, so the app doesn't have to wait.
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(analyse());
  else await analyse();

  return json({ id: row.id });
});
