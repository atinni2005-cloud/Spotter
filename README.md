# Spotter

An AI fitness coach for people who train in the gym. Built with Expo (React Native, iOS + Android) and Supabase, with Claude as the coach.

## What's in stage one

- **Accounts**: email + password sign-up and sign-in (Supabase Auth).
- **Onboarding**: goal (lose fat, build muscle, get stronger, general fitness), experience, training days, session length, training split (PPL, upper/lower, full body, bro split, Arnold, custom, or let the coach choose), exercises per session, injuries.
- **AI coach chat**: replies stream in word by word. The coach knows your profile, today's energy and your current plan, and can build a new week for you from the chat.
- **Weekly plan**: generated from your goal, split, schedule and today's energy. Each exercise has a "Watch" link to a form demo video. Every day is editable: rename it, make it a rest day, add, remove, reorder and change exercises, sets, reps and rest.
- **Energy check-in**: five quick questions give an energy %. Low energy lightens today's session; below your rest threshold (30% by default, changeable in Profile) the coach suggests a rest day.

## What's in stage two

- **Food photo macros** (Eat tab): snap or choose a photo, or type what you ate. Claude estimates calories, protein, carbs and fat per item; you can fix any number before saving.
- **Daily targets**: add sex, birth year, height and weight and Spotter works out calories and protein from your goal and training days (all editable).
- **Meal ideas**: a meal that fills what you have left today. Tap any ingredient you don't have and Spotter swaps it for an equivalent with similar calories and protein.
- **Over-target heads-up**: a friendly note on the Eat tab and right after logging a meal that takes you over calories, protein, carbs or fat. The evening reminder and the coach mention it too.
- **Meal reminder**: pick a time. If you're short on protein or calories then, you get a notification with a meal that fills the gap. Reminders are local notifications, so they work in Expo Go.
- **Workout logging**: start a day from the Plan tab, log weight and reps per set, see what you did last time, and get a "go heavier" hint once you hit the top of the rep range. Low energy lightens the number of sets.
- **Form check**: film your first set (or pick a video). The app uploads it and sends still frames to Claude; feedback (what went well, up to 3 fixes with cues, safety notes, what to do next set) arrives about a minute later.
- **Coach**: now also knows today's food vs targets, your recent workouts and your latest form feedback.
- **Energy check-in**: a separate question for sleep hours and how rested you feel.

Not yet: reading sleep from Apple Health or a watch. That needs a development build of the app (not Expo Go) and an Apple developer account, so it's a separate step.

## What's in stage three

- **Machine taken? Swap it**: during a workout, tap "Machine taken? Swap it" on any exercise. Spotter suggests 2 or 3 exercises that work the same muscles with the same movement on different equipment (dumbbells, cables, another machine), so your split, goal and number of exercises stay the same. Tell it what else is busy for more options. Pick one and log it as normal; "Switch back" returns to the original. Sets you already logged stay saved.
- **Full recipes**: "Suggest a meal" now gives a full recipe: exact ingredient amounts, step-by-step cooking instructions, prep and cook time, and calories, protein, carbs and fat. Ingredient swaps update the amounts, steps and macros too.
- **Saved recipes**: save a recipe you like with "Save recipe" and find it later under "Saved recipes" on the Eat tab. Tap "I ate this" to log it as a meal in one tap.

## How it fits together

```
Expo app (src/)  ──►  Supabase Auth + Postgres (row-level security: users only see their own data)
       │
       └──────────►  Supabase Edge Functions (supabase/functions/)
                        coach          streams chat replies, can create a plan
                        generate-plan  builds a plan from the Plan tab
                        nutrition      food photo estimates + meal suggestions
                        form-check     reviews frames from a set video (in the background)
                        swap-exercise  equivalent exercises when a machine is taken
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
npx supabase functions deploy nutrition --use-api
npx supabase functions deploy form-check --use-api
npx supabase functions deploy swap-exercise --use-api
```

(Or deploy them all at once with `npx supabase functions deploy --use-api`.)

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
  (tabs)/eat.tsx         today's food vs targets, meal ideas
  (tabs)/profile.tsx     settings, rest threshold, sign out
  plan/[dayId].tsx       edit one day of the plan
  workout/[dayId].tsx    log a workout set by set
  meal/new.tsx           photo / text meal logging
  nutrition-settings.tsx body stats, targets, meal reminder time
  form-check/new.tsx     film and send a set
  form-check/[id].tsx    form feedback
  form-checks.tsx        form check history
  recipes.tsx            saved recipes
  recipe/[id].tsx        one saved recipe
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
