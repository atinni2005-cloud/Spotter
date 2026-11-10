import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

export type Ctx = { supabase: SupabaseClient; user: User };

/**
 * Builds a Supabase client that acts as the signed-in user (row-level security
 * applies), and resolves that user from the request's bearer token.
 * Returns null when the token is missing or invalid.
 */
export async function getUserContext(req: Request): Promise<Ctx | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  // The app sends its public key as `apikey`; fall back to the project's anon key.
  const apiKey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    apiKey,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );

  const token = authHeader.slice("Bearer ".length);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { supabase, user: data.user };
}
