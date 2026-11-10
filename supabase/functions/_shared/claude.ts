import Anthropic from "npm:@anthropic-ai/sdk@1";

export const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

// Override with `supabase secrets set ANTHROPIC_MODEL=...` if you want a different model.
export const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-5-5";

// If the main model declines a request, the API retries it on a fallback model
// chosen by the API (server-side fallback, "default" routing).
export const FALLBACK = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default" as const,
};
