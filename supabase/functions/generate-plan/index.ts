// Generates a new weekly plan for the signed-in user from the Plan tab.
//
// Request:  POST { "notes"?: "..." }  (Authorization: Bearer <user access token>)
// Response: { "planId": "...", "title": "...", "summary": "..." }

import { loadProfile, loadRecentEnergy } from "../_shared/context.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { generateAndSavePlan } from "../_shared/plan.ts";
import { getUserContext } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const ctx = await getUserContext(req);
  if (!ctx) return json({ error: "Not signed in" }, 401);

  let notes = "";
  try {
    const body = await req.json();
    if (typeof body?.notes === "string") notes = body.notes.slice(0, 1000);
  } catch {
    // An empty body is fine.
  }

  try {
    const [profile, energy] = await Promise.all([
      loadProfile(ctx.supabase, ctx.user.id),
      loadRecentEnergy(ctx.supabase),
    ]);
    if (!profile.goal) return json({ error: "Finish onboarding first" }, 400);
    const plan = await generateAndSavePlan(ctx.supabase, profile, energy, notes);
    return json(plan);
  } catch (err) {
    console.error("generate-plan failed", err);
    return json({ error: "Could not create a plan right now. Please try again." }, 500);
  }
});
