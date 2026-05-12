create extension if not exists pgcrypto;

do $$ begin
  create type public.item_type as enum ('word', 'sentence', 'dialogue');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.study_result as enum ('thuoc', 'chua_thuoc');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  image_url text not null,
  source_name text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  type public.item_type not null default 'sentence',
  hanzi text not null,
  pinyin text,
  meaning text,
  mastery int not null default 1 check (mastery between 1 and 5),
  shown_count int not null default 0,
  last_shown_at timestamptz,
  last_studied_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.study_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  result public.study_result not null,
  studied_at timestamptz not null default now()
);

create or replace function public.has_chinese_text(value text)
returns boolean
language sql
immutable
as $$
  select coalesce(value, '') ~ '[一-龯]';
$$;

delete from public.items
where not public.has_chinese_text(hanzi)
   or public.has_chinese_text(pinyin);

update public.items
set meaning = btrim(regexp_replace(coalesce(meaning, ''), '[一-龯]+', '', 'g'))
where public.has_chinese_text(meaning);

alter table public.documents enable row level security;
alter table public.items enable row level security;
alter table public.study_logs enable row level security;

drop policy if exists "documents select own" on public.documents;
drop policy if exists "documents insert own" on public.documents;
drop policy if exists "documents update own" on public.documents;
drop policy if exists "documents delete own" on public.documents;
drop policy if exists "items select own" on public.items;
drop policy if exists "items insert own" on public.items;
drop policy if exists "items update own" on public.items;
drop policy if exists "items delete own" on public.items;
drop policy if exists "items shared code select" on public.items;
drop policy if exists "items shared code insert" on public.items;
drop policy if exists "items shared code update" on public.items;
drop policy if exists "study logs select own" on public.study_logs;
drop policy if exists "study logs insert own" on public.study_logs;

create policy "documents select own" on public.documents for select to authenticated using (auth.uid() = user_id);
create policy "documents insert own" on public.documents for insert to authenticated with check (auth.uid() = user_id);
create policy "documents update own" on public.documents for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "documents delete own" on public.documents for delete to authenticated using (auth.uid() = user_id);

create policy "items select own" on public.items for select to authenticated using (auth.uid() = user_id);
create policy "items insert own" on public.items for insert to authenticated with check (auth.uid() = user_id);
create policy "items update own" on public.items for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "items delete own" on public.items for delete to authenticated using (auth.uid() = user_id);

create policy "items shared code select" on public.items for select to anon, authenticated
using (user_id = '88d2c940-8702-41c9-8669-7b176f01c216'::uuid);

create policy "items shared code insert" on public.items for insert to anon, authenticated
with check (user_id = '88d2c940-8702-41c9-8669-7b176f01c216'::uuid);

create policy "items shared code update" on public.items for update to anon, authenticated
using (user_id = '88d2c940-8702-41c9-8669-7b176f01c216'::uuid)
with check (user_id = '88d2c940-8702-41c9-8669-7b176f01c216'::uuid);

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.items to anon, authenticated;

create policy "study logs select own" on public.study_logs for select to authenticated using (auth.uid() = user_id);
create policy "study logs insert own" on public.study_logs for insert to authenticated with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.items
    where items.id = study_logs.item_id
    and items.user_id = auth.uid()
  )
);

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists "documents storage select own" on storage.objects;
drop policy if exists "documents storage insert own" on storage.objects;
drop policy if exists "documents storage update own" on storage.objects;
drop policy if exists "documents storage delete own" on storage.objects;

create policy "documents storage select own"
on storage.objects for select to authenticated
using (bucket_id = 'documents' and name like auth.uid()::text || '/%');

create policy "documents storage insert own"
on storage.objects for insert to authenticated
with check (bucket_id = 'documents' and name like auth.uid()::text || '/%');

create policy "documents storage update own"
on storage.objects for update to authenticated
using (bucket_id = 'documents' and name like auth.uid()::text || '/%')
with check (bucket_id = 'documents' and name like auth.uid()::text || '/%');

create policy "documents storage delete own"
on storage.objects for delete to authenticated
using (bucket_id = 'documents' and name like auth.uid()::text || '/%');

create or replace function public.pick_next_item(
  p_document_id uuid default null,
  p_max_mastery int default 5
)
returns setof public.items
language plpgsql
security definer
set search_path = public
as $$
declare
  picked_id uuid;
begin
  select id into picked_id
  from public.items
  where user_id = auth.uid()
    and public.has_chinese_text(hanzi)
    and (p_document_id is null or document_id = p_document_id)
    and mastery <= p_max_mastery
  order by shown_count asc, last_shown_at asc nulls first, random()
  limit 1
  for update skip locked;

  if picked_id is null then
    return;
  end if;

  update public.items
  set shown_count = shown_count + 1,
      last_shown_at = now()
  where id = picked_id
    and user_id = auth.uid();

  return query
  select *
  from public.items
  where id = picked_id
    and user_id = auth.uid();
end;
$$;

grant execute on function public.pick_next_item(uuid, int) to authenticated;
