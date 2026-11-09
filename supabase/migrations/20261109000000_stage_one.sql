-- Spotter: stage one schema
-- Stage one uses: profiles, energy_checkins, workout_plans, plan_days,
-- plan_exercises, chat_messages.
-- Later-stage tables (workout_sessions, set_logs, form_checks, meal_logs) are
-- created now so the data model is stable; the app does not write to them yet.
-- Every table is protected by row-level security: a user can only see and
-- change their own rows.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.fitness_goal as enum (
  'lose_fat', 'build_muscle', 'get_stronger', 'general_fitness'
);

create type public.experience_level as enum (
  'beginner', 'intermediate', 'advanced'
);

-- Where an energy reading came from. Stage one only uses 'questions'.
create type public.energy_source as enum (
  'questions', 'apple_health', 'health_connect', 'manual'
);

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles (one row per auth user, created automatically on sign-up)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  goal public.fitness_goal,
  experience public.experience_level,
  days_per_week smallint check (days_per_week between 1 and 7),
  session_minutes smallint check (session_minutes between 15 and 240),
  -- 0 = Monday ... 6 = Sunday
  training_days smallint[] not null default '{}',
  injuries text,
  units text not null default 'kg' check (units in ('kg', 'lb')),
  -- Below this energy %, the coach suggests a rest day instead of training.
  rest_threshold smallint not null default 30 check (rest_threshold between 0 and 100),
  timezone text not null default 'UTC',
  onboarded_at timestamptz,

  -- Later stages: wearables + nutrition
  health_sync_enabled boolean not null default false,
  calorie_target integer,
  protein_target_g integer,
  carbs_target_g integer,
  fat_target_g integer,
  meal_reminder_time time,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', null));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Energy check-ins (0-100%). Stage one: answers to tailored questions.
-- Later: readings from Apple Health / Health Connect go in `metrics`.
-- ---------------------------------------------------------------------------
create table public.energy_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  score smallint not null check (score between 0 and 100),
  source public.energy_source not null default 'questions',
  answers jsonb,
  metrics jsonb,
  created_at timestamptz not null default now()
);

create index energy_checkins_user_created_idx
  on public.energy_checkins (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Weekly workout plans: plan -> days -> exercises (all editable by the user)
-- ---------------------------------------------------------------------------
create table public.workout_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  week_start date not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  goal public.fitness_goal,
  energy_score smallint check (energy_score between 0 and 100),
  title text not null default 'My week',
  summary text,
  source text not null default 'ai' check (source in ('ai', 'user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one active plan per user.
create unique index workout_plans_one_active_idx
  on public.workout_plans (user_id) where status = 'active';

create trigger workout_plans_updated_at
  before update on public.workout_plans
  for each row execute function public.set_updated_at();

create table public.plan_days (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.workout_plans (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  day_index smallint not null check (day_index between 0 and 6),
  title text not null,
  focus text,
  is_rest boolean not null default false,
  notes text,
  unique (plan_id, day_index)
);

create index plan_days_plan_idx on public.plan_days (plan_id);

create table public.plan_exercises (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references public.plan_days (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  position smallint not null default 0,
  name text not null,
  -- Machine/equipment used; later stages can swap to an equivalent machine.
  equipment text,
  sets smallint not null default 3 check (sets between 1 and 20),
  reps text not null default '8-12',
  rest_seconds smallint check (rest_seconds between 0 and 900),
  target_rpe numeric(3, 1) check (target_rpe between 1 and 10),
  notes text
);

create index plan_exercises_day_idx on public.plan_exercises (day_id, position);

-- ---------------------------------------------------------------------------
-- Coach chat history
-- ---------------------------------------------------------------------------
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- Set when the coach created a plan during this reply.
  plan_id uuid references public.workout_plans (id) on delete set null,
  created_at timestamptz not null default now()
);

create index chat_messages_user_created_idx
  on public.chat_messages (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Later stages (schema only for now)
-- ---------------------------------------------------------------------------

-- A logged workout. `energy_checkin_id` + `adjusted` record when a session was
-- lightened (or skipped) because of low energy.
create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  plan_day_id uuid references public.plan_days (id) on delete set null,
  energy_checkin_id uuid references public.energy_checkins (id) on delete set null,
  adjusted boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  notes text
);

create table public.set_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  exercise_id uuid references public.plan_exercises (id) on delete set null,
  exercise_name text not null,
  set_number smallint not null,
  reps smallint,
  weight numeric(6, 2),
  rpe numeric(3, 1),
  created_at timestamptz not null default now()
);

-- Form check: the user uploads a video of their first set, feedback arrives after.
create table public.form_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  set_log_id uuid references public.set_logs (id) on delete set null,
  exercise_name text not null,
  video_path text not null,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'done', 'failed')),
  feedback jsonb,
  created_at timestamptz not null default now()
);

-- Food photo -> estimated calories and macros.
create table public.meal_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  photo_path text,
  description text,
  eaten_at timestamptz not null default now(),
  calories integer,
  protein_g numeric(6, 1),
  carbs_g numeric(6, 1),
  fat_g numeric(6, 1),
  confidence numeric(3, 2),
  raw jsonb,
  created_at timestamptz not null default now()
);

create index meal_logs_user_eaten_idx on public.meal_logs (user_id, eaten_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

do $$
declare
  t text;
begin
  foreach t in array array[
    'energy_checkins', 'workout_plans', 'plan_days', 'plan_exercises',
    'chat_messages', 'workout_sessions', 'set_logs', 'form_checks', 'meal_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- save_weekly_plan: archive the current active plan and insert a new one with
-- its days and exercises in a single transaction. Runs as the calling user,
-- so row-level security still applies.
--
-- Expected shape:
-- { "week_start": "2026-11-09", "goal": "build_muscle", "energy_score": 72,
--   "title": "...", "summary": "...", "source": "ai",
--   "days": [ { "day_index": 0, "title": "...", "focus": "...", "is_rest": false,
--               "notes": "...", "exercises": [ { "name": "...", "equipment": "...",
--               "sets": 3, "reps": "8-10", "rest_seconds": 90, "target_rpe": 8,
--               "notes": "..." } ] } ] }
-- ---------------------------------------------------------------------------
create or replace function public.save_weekly_plan(plan jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_plan_id uuid;
  day jsonb;
  new_day_id uuid;
  ex jsonb;
  pos smallint;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  update public.workout_plans
     set status = 'archived'
   where user_id = uid and status = 'active';

  insert into public.workout_plans (user_id, week_start, goal, energy_score, title, summary, source)
  values (
    uid,
    (plan ->> 'week_start')::date,
    (plan ->> 'goal')::public.fitness_goal,
    (plan ->> 'energy_score')::smallint,
    coalesce(plan ->> 'title', 'My week'),
    plan ->> 'summary',
    coalesce(plan ->> 'source', 'ai')
  )
  returning id into new_plan_id;

  for day in select * from jsonb_array_elements(coalesce(plan -> 'days', '[]'::jsonb))
  loop
    insert into public.plan_days (plan_id, user_id, day_index, title, focus, is_rest, notes)
    values (
      new_plan_id,
      uid,
      (day ->> 'day_index')::smallint,
      coalesce(day ->> 'title', 'Day'),
      day ->> 'focus',
      coalesce((day ->> 'is_rest')::boolean, false),
      day ->> 'notes'
    )
    returning id into new_day_id;

    pos := 0;
    for ex in select * from jsonb_array_elements(coalesce(day -> 'exercises', '[]'::jsonb))
    loop
      insert into public.plan_exercises
        (day_id, user_id, position, name, equipment, sets, reps, rest_seconds, target_rpe, notes)
      values (
        new_day_id,
        uid,
        pos,
        ex ->> 'name',
        ex ->> 'equipment',
        coalesce((ex ->> 'sets')::smallint, 3),
        coalesce(ex ->> 'reps', '8-12'),
        (ex ->> 'rest_seconds')::smallint,
        (ex ->> 'target_rpe')::numeric,
        ex ->> 'notes'
      );
      pos := pos + 1;
    end loop;
  end loop;

  return new_plan_id;
end;
$$;
