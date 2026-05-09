create table if not exists public.mandarin_decks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cards jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.mandarin_decks enable row level security;

create policy "Users can read their own Mandarin deck"
on public.mandarin_decks
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own Mandarin deck"
on public.mandarin_decks
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own Mandarin deck"
on public.mandarin_decks
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
