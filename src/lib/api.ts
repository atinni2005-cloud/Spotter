import { fetch as expoFetch } from 'expo/fetch';
import { functionsUrl, supabase } from './supabase';

export type CoachEvent =
  | { type: 'text'; text: string }
  | { type: 'status'; text: string }
  | { type: 'plan'; planId: string; title: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You are signed out. Please sign in again.');
  return {
    Authorization: `Bearer ${token}`,
    apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    'Content-Type': 'application/json',
  };
}

async function errorMessage(res: { text(): Promise<string>; status: number }): Promise<string> {
  try {
    const body = JSON.parse(await res.text());
    if (body?.error) return String(body.error);
  } catch {
    // fall through
  }
  return `Request failed (${res.status})`;
}

/**
 * Sends a message to the coach and calls `onEvent` for each streamed event,
 * so the reply appears word by word.
 */
export async function streamCoach(
  message: string,
  onEvent: (event: CoachEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await expoFetch(`${functionsUrl}/coach`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ message }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(await errorMessage(res));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line) as CoachEvent);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as CoachEvent);
}

export async function generatePlan(notes?: string): Promise<{ planId: string; title: string; summary: string }> {
  const res = await fetch(`${functionsUrl}/generate-plan`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ notes: notes ?? '' }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

async function post<T>(fn: string, body: unknown): Promise<T> {
  const res = await fetch(`${functionsUrl}/${fn}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export type MealEstimate = {
  name: string;
  items: { name: string; portion: string; calories: number; protein_g: number; carbs_g: number; fat_g: number }[];
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: number;
  note: string;
};

/** Estimate calories and macros from a food photo (base64 JPEG) and/or a description. */
export function analyzeMeal(input: { imageBase64?: string; description?: string }): Promise<MealEstimate> {
  return post('nutrition', { action: 'analyze', image_base64: input.imageBase64, description: input.description });
}

export type MealSuggestion = {
  remaining: { calories: number | null; protein_g: number | null };
  met: boolean;
  suggestion: { title: string; description: string; calories: number; protein_g: number } | null;
};

/** A meal idea that fills today's gap to the user's targets (null when targets are met). */
export function suggestMeal(): Promise<MealSuggestion> {
  return post('nutrition', { action: 'suggest' });
}

/** Start the background form review. Returns the form check id to watch. */
export function startFormCheck(input: {
  exerciseName: string;
  videoPath: string;
  frames: { t: number; data: string }[];
  durationS?: number;
  setLogId?: string | null;
  notes?: string;
}): Promise<{ id: string }> {
  return post('form-check', {
    exercise_name: input.exerciseName,
    video_path: input.videoPath,
    frames: input.frames,
    duration_s: input.durationS,
    set_log_id: input.setLogId ?? null,
    notes: input.notes ?? '',
  });
}
