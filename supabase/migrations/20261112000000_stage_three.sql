-- Spotter: stage three
-- Taken-machine swaps and saved recipes. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- Taken-machine swap: remember what an exercise was before it was swapped,
-- so the app can show "swapped from ..." and switch back.
-- Shape: { "name": "...", "equipment": "...", "reps": "...", "notes": "..." }
-- ---------------------------------------------------------------------------
alter table public.plan_exercises
  add column if not exists swapped_from jsonb;

-- ---------------------------------------------------------------------------
-- Saved (favourite) recipes
-- ---------------------------------------------------------------------------
create table if not exists public.saved_recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null,
  description text,
  calories integer,
  protein_g numeric(6, 1),
  carbs_g numeric(6, 1),
  fat_g numeric(6, 1),
  prep_minutes smallint,
  cook_minutes smallint,
  servings smallint not null default 1,
  -- [{ "name": "Chicken breast", "amount": "150 g" }, ...]
  ingredients jsonb not null default '[]'::jsonb,
  -- ["Season the chicken...", "Cook for 6 minutes...", ...]
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists saved_recipes_user_created_idx
  on public.saved_recipes (user_id, created_at desc);

alter table public.saved_recipes enable row level security;
drop policy if exists "own rows" on public.saved_recipes;
create policy "own rows" on public.saved_recipes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
