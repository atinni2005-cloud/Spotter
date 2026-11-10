-- Spotter: the user's preferred training split.
-- 'auto' lets the coach choose. 'custom' uses the free-text split_notes.
alter table public.profiles
  add column training_split text not null default 'auto'
    check (training_split in (
      'auto', 'full_body', 'upper_lower', 'push_pull_legs', 'bro_split', 'arnold', 'custom'
    )),
  add column split_notes text;
