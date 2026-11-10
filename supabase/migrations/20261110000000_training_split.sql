-- Spotter: training preferences.
-- training_split: 'auto' lets the coach choose; 'custom' uses split_notes.
-- exercises_per_session: how many exercises the user wants per training day
-- (null = coach decides).
-- Safe to run more than once.
alter table public.profiles
  add column if not exists training_split text not null default 'auto'
    check (training_split in (
      'auto', 'full_body', 'upper_lower', 'push_pull_legs', 'bro_split', 'arnold', 'custom'
    )),
  add column if not exists split_notes text,
  add column if not exists exercises_per_session smallint
    check (exercises_per_session between 1 and 12);
