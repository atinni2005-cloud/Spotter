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
