-- Spotter: stage two
-- Food photo macros + daily targets + meal reminders, workout logging,
-- and form check videos. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- Body stats used to work out calorie and protein targets
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists sex text check (sex in ('male', 'female')),
  add column if not exists birth_year smallint check (birth_year between 1900 and 2100),
  add column if not exists height_cm numeric(5, 1) check (height_cm between 100 and 250),
  add column if not exists weight_kg numeric(5, 1) check (weight_kg between 30 and 300);

-- ---------------------------------------------------------------------------
-- Meal logs: a short name and where the estimate came from
-- ---------------------------------------------------------------------------
alter table public.meal_logs
  add column if not exists name text,
  add column if not exists source text not null default 'photo'
    check (source in ('photo', 'text', 'manual'));

-- ---------------------------------------------------------------------------
-- Faster lookups for "what did I lift last time?"
-- ---------------------------------------------------------------------------
create index if not exists set_logs_user_exercise_idx
  on public.set_logs (user_id, exercise_name, created_at desc);
create index if not exists set_logs_session_idx
  on public.set_logs (session_id);
create index if not exists workout_sessions_user_started_idx
  on public.workout_sessions (user_id, started_at desc);
create index if not exists form_checks_user_created_idx
  on public.form_checks (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Private storage for form check videos.
-- Files live under "<user id>/..." and only that user can read or write them.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('form-videos', 'form-videos', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "form videos: own folder read" on storage.objects;
create policy "form videos: own folder read" on storage.objects
  for select to authenticated
  using (bucket_id = 'form-videos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "form videos: own folder insert" on storage.objects;
create policy "form videos: own folder insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'form-videos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "form videos: own folder delete" on storage.objects;
create policy "form videos: own folder delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'form-videos' and (storage.foldername(name))[1] = auth.uid()::text);
