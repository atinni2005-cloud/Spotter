# Spotter

An AI fitness coach for people who train in the gym. Built with Expo (React Native, iOS + Android) and Supabase, with Claude as the coach.

## What's in stage one

- **Accounts**: email + password sign-up and sign-in (Supabase Auth).
- **Onboarding**: goal (lose fat, build muscle, get stronger, general fitness), experience, training days, session length, training split (PPL, upper/lower, full body, bro split, Arnold, custom, or let the coach choose), injuries.
- **AI coach chat**: replies stream in word by word. The coach knows your profile, today's energy and your current plan, and can build a new week for you from the chat.
- **Weekly plan**: generated from your goal, schedule and today's energy. Every day is editable: rename it, make it a rest day, add, remove, reorder and change exercises, sets, reps and rest.
- **Energy check-in**: five quick questions give an energy %. Low energy lightens today's session; below your rest threshold (30% by default, changeable in Profile) the coach suggests a rest day.

The database already has tables for later stages (workout logging, form-check videos, meal photos and macro targets), so those can be added without reshaping the data.

## How it fits together

```
Expo app (src/)  ──►  Supabase Auth + Postgres (row-level security: users only see their own data)
       │
       └──────────►  Supabase Edge Functions (supabase/functions/)
                        coach          streams chat replies, can create a plan
                        generate-plan  builds a plan from the Plan tab
                              │
                              └──►  Claude API (key stored as a Supabase secret, never in the app)
```

## Setup

You need: a free [Supabase](https://supabase.com) project, an [Anthropic API key](https://console.anthropic.com), Node.js 22 (22.13 or newer; check with `node -v`), and the **Expo Go** app on your phone.

### 1. Database

In the Supabase dashboard, open **SQL Editor** and run each file in `supabase/migrations/` in order (oldest first): paste the whole file, click **Run**.

For easier testing, turn off email confirmation: **Authentication → Sign In / Providers → Email → Confirm email** (off). Turn it back on before launch.

### 2. Edge functions and the AI key

From this folder:

```bash
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF      # the part before .supabase.co in your project URL
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...  # your Anthropic key
npx supabase functions deploy coach --use-api
npx supabase functions deploy generate-plan --use-api
```

The coach uses `claude-opus-5-5` by default. To use a different Claude model: `npx supabase secrets set ANTHROPIC_MODEL=<model id>`.

### 3. Run the app

```bash
cp .env.example .env.local   # then fill in your Supabase URL and anon/publishable key
npm install
npx expo start
```

Scan the QR code with your phone's camera (iOS) or the Expo Go app (Android).

## Project layout

```
src/app/                 screens (Expo Router: every file is a route)
  sign-in.tsx            sign up / sign in
  onboarding.tsx         4-step onboarding
  (tabs)/index.tsx       coach chat
  (tabs)/plan.tsx        energy card + weekly plan
  (tabs)/profile.tsx     settings, rest threshold, sign out
  plan/[dayId].tsx       edit one day of the plan
  check-in.tsx           energy check-in
src/lib/                 Supabase client, API calls, energy scoring, types, theme
src/providers/           auth/session state
supabase/migrations/     database schema + row-level security
supabase/functions/      edge functions (Deno)
```

## Checks

```bash
npm run typecheck
```
