begin;

create extension if not exists pgcrypto;

do $$ begin
  create type public.item_type as enum ('word', 'sentence', 'dialogue');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.item_difficulty as enum ('easy', 'hard');
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
  lesson_no int not null,
  type public.item_type not null default 'sentence',
  difficulty public.item_difficulty not null default 'easy',
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

create table if not exists public.study_counters (
  user_id uuid primary key,
  create_count int not null default 0 check (create_count >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.exam_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  group_id text,
  section text not null,
  type text not null,
  question text not null,
  prompt text,
  option_a text,
  option_b text,
  option_c text,
  option_d text,
  answer text not null,
  audio_text text,
  hanzi text,
  pinyin text,
  meaning text,
  explanation text,
  difficulty public.item_difficulty not null default 'easy',
  tags text,
  scored boolean not null default true,
  shown_count int not null default 0,
  last_shown_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.exam_questions
add column if not exists group_id text;
alter table public.exam_questions
add column if not exists shown_count int not null default 0;
alter table public.exam_questions
add column if not exists last_shown_at timestamptz;

create index if not exists exam_questions_user_section_idx on public.exam_questions(user_id, section);
create index if not exists exam_questions_user_group_idx on public.exam_questions(user_id, group_id);
create index if not exists exam_questions_frequency_idx on public.exam_questions(user_id, section, shown_count, last_shown_at);
create index if not exists exam_questions_created_idx on public.exam_questions(user_id, created_at desc);

alter table public.documents drop constraint if exists documents_user_id_fkey;
alter table public.items drop constraint if exists items_user_id_fkey;
alter table public.study_logs drop constraint if exists study_logs_user_id_fkey;

alter table public.items
add column if not exists difficulty public.item_difficulty not null default 'easy';

alter table public.items
add column if not exists lesson_no int;

do $$ begin
  alter table public.items
  add constraint items_lesson_no_positive check (lesson_no > 0);
exception
  when duplicate_object then null;
end $$;

with ranked as (
  select
    id,
    ceil(row_number() over (partition by user_id order by created_at, id) / 10.0)::int as lesson_no
  from public.items
  where lesson_no is null and type = 'word'
)
update public.items as item
set lesson_no = ranked.lesson_no
from ranked
where item.id = ranked.id;

with ranked as (
  select
    id,
    ceil(row_number() over (partition by user_id order by created_at, id) / 10.0)::int as lesson_no
  from public.items
  where lesson_no is null and type <> 'word'
)
update public.items as item
set lesson_no = ranked.lesson_no
from ranked
where item.id = ranked.id;

create or replace function public.normalize_hanzi_key(value text)
returns text
language sql
immutable
as $function$
  select translate(
    regexp_replace(coalesce(value, ''), '[[:space:]]+', '', 'g'),
    $punct$，。！？、；：「」『』（）《》,.!?;:'"()[]{}<>$punct$,
    ''
  );
$function$;

-- Giữ bản ghi đầu tiên của mỗi Hán tự để một lần upload trùng không tự chuyển bài của dữ liệu cũ.
with duplicate_groups as (
  select
    user_id,
    public.normalize_hanzi_key(hanzi) as hanzi_key,
    max(shown_count) as max_shown_count,
    max(last_shown_at) as max_last_shown_at
  from public.items
  group by user_id, public.normalize_hanzi_key(hanzi)
  having count(*) > 1
), ranked_duplicates as (
  select
    item.id,
    item.user_id,
    public.normalize_hanzi_key(item.hanzi) as hanzi_key,
    row_number() over (
      partition by item.user_id, public.normalize_hanzi_key(item.hanzi)
      order by item.created_at asc, item.id asc
    ) as duplicate_rank
  from public.items item
  join duplicate_groups groups
    on groups.user_id = item.user_id
   and groups.hanzi_key = public.normalize_hanzi_key(item.hanzi)
)
update public.items item
set shown_count = groups.max_shown_count,
    last_shown_at = groups.max_last_shown_at
from duplicate_groups groups
join ranked_duplicates ranked
  on ranked.user_id = groups.user_id
 and ranked.hanzi_key = groups.hanzi_key
 and ranked.duplicate_rank = 1
where item.id = ranked.id;

with ranked_duplicates as (
  select
    id,
    row_number() over (
      partition by user_id, public.normalize_hanzi_key(hanzi)
      order by created_at asc, id asc
    ) as duplicate_rank
  from public.items
)
delete from public.items item
using ranked_duplicates ranked
where item.id = ranked.id
  and ranked.duplicate_rank > 1;

alter table public.items
alter column lesson_no set not null;

create unique index if not exists items_user_hanzi_key_unique_idx
on public.items(user_id, public.normalize_hanzi_key(hanzi));

create index if not exists items_user_lesson_frequency_idx
on public.items(user_id, lesson_no, type, difficulty, shown_count, last_shown_at);

update public.items
set difficulty = 'easy'
where difficulty is null;

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
alter table public.study_counters enable row level security;
alter table public.exam_questions enable row level security;

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
drop policy if exists "study counters shared code select" on public.study_counters;
drop policy if exists "study counters shared code insert" on public.study_counters;
drop policy if exists "study counters shared code update" on public.study_counters;
drop policy if exists "exam questions shared code select" on public.exam_questions;
drop policy if exists "exam questions shared code insert" on public.exam_questions;
drop policy if exists "exam questions shared code update" on public.exam_questions;
drop policy if exists "exam questions shared code delete" on public.exam_questions;

create policy "documents select own" on public.documents for select to authenticated using (auth.uid() = user_id);
create policy "documents insert own" on public.documents for insert to authenticated with check (auth.uid() = user_id);
create policy "documents update own" on public.documents for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "documents delete own" on public.documents for delete to authenticated using (auth.uid() = user_id);

create policy "items select own" on public.items for select to authenticated using (auth.uid() = user_id);
create policy "items insert own" on public.items for insert to authenticated with check (auth.uid() = user_id);
create policy "items update own" on public.items for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "items delete own" on public.items for delete to authenticated using (auth.uid() = user_id);

create policy "items shared code select" on public.items for select to anon, authenticated
using (user_id in (
  '88d2c940-8702-41c9-8669-7b176f01c216'::uuid,
  'b5e519d5-c39c-4f27-849d-d0d46db9d134'::uuid
));

create policy "items shared code insert" on public.items for insert to anon, authenticated
with check (user_id in (
  '88d2c940-8702-41c9-8669-7b176f01c216'::uuid,
  'b5e519d5-c39c-4f27-849d-d0d46db9d134'::uuid
));

create policy "items shared code update" on public.items for update to anon, authenticated
using (user_id in (
  '88d2c940-8702-41c9-8669-7b176f01c216'::uuid,
  'b5e519d5-c39c-4f27-849d-d0d46db9d134'::uuid
))
with check (user_id in (
  '88d2c940-8702-41c9-8669-7b176f01c216'::uuid,
  'b5e519d5-c39c-4f27-849d-d0d46db9d134'::uuid
));

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.items to anon, authenticated;
grant select, insert, update on public.study_counters to anon, authenticated;
grant select, insert, update, delete on public.exam_questions to anon, authenticated;

create policy "study logs select own" on public.study_logs for select to authenticated using (auth.uid() = user_id);
create policy "study logs insert own" on public.study_logs for insert to authenticated with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.items
    where items.id = study_logs.item_id
    and items.user_id = auth.uid()
  )
);

create policy "study counters shared code select" on public.study_counters for select to anon, authenticated
using (user_id in (
  '88d2c940-8702-41c9-8669-7b176f01c216'::uuid,
  'b5e519d5-c39c-4f27-849d-d0d46db9d134'::uuid
));

create policy "study counters shared code insert" on public.study_counters for insert to anon, authenticated
with check (user_id in (
  '88d2c940-8702-41c9-8669-7b176f01c216'::uuid,
  'b5e519d5-c39c-4f27-849d-d0d46db9d134'::uuid
));

create policy "study counters shared code update" on public.study_counters for update to anon, authenticated
using (user_id in (
  '88d2c940-8702-41c9-8669-7b176f01c216'::uuid,
  'b5e519d5-c39c-4f27-849d-d0d46db9d134'::uuid
))
with check (user_id in (
  '88d2c940-8702-41c9-8669-7b176f01c216'::uuid,
  'b5e519d5-c39c-4f27-849d-d0d46db9d134'::uuid
));

create policy "exam questions shared code select" on public.exam_questions for select to anon, authenticated
using (user_id in (
  '88d2c940-8702-41c9-8669-7b176f01c216'::uuid,
  'b5e519d5-c39c-4f27-849d-d0d46db9d134'::uuid
));

create policy "exam questions shared code insert" on public.exam_questions for insert to anon, authenticated
with check (user_id in (
  '88d2c940-8702-41c9-8669-7b176f01c216'::uuid,
  'b5e519d5-c39c-4f27-849d-d0d46db9d134'::uuid
));

create policy "exam questions shared code update" on public.exam_questions for update to anon, authenticated
using (user_id in (
  '88d2c940-8702-41c9-8669-7b176f01c216'::uuid,
  'b5e519d5-c39c-4f27-849d-d0d46db9d134'::uuid
))
with check (user_id in (
  '88d2c940-8702-41c9-8669-7b176f01c216'::uuid,
  'b5e519d5-c39c-4f27-849d-d0d46db9d134'::uuid
));

create policy "exam questions shared code delete" on public.exam_questions for delete to anon, authenticated
using (user_id in (
  '88d2c940-8702-41c9-8669-7b176f01c216'::uuid,
  'b5e519d5-c39c-4f27-849d-d0d46db9d134'::uuid
));

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

create or replace function public.increment_create_count(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count int;
begin
  if p_user_id not in (
    '88d2c940-8702-41c9-8669-7b176f01c216'::uuid,
    'b5e519d5-c39c-4f27-849d-d0d46db9d134'::uuid
  ) then
    raise exception 'Invalid shared account';
  end if;

  insert into public.study_counters (user_id, create_count, updated_at)
  values (p_user_id, 1, now())
  on conflict (user_id) do update
  set create_count = public.study_counters.create_count + 1,
      updated_at = now()
  returning create_count into next_count;

  return next_count;
end;
$$;

grant execute on function public.increment_create_count(uuid) to anon, authenticated;

create or replace function public.start_study_session(
  p_user_id uuid,
  p_item_ids uuid[]
)
returns setof public.items
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_count int;
  matched_count int;
  session_time timestamptz := now();
begin
  if p_user_id not in (
    '88d2c940-8702-41c9-8669-7b176f01c216'::uuid,
    'b5e519d5-c39c-4f27-849d-d0d46db9d134'::uuid
  ) then
    raise exception 'Invalid shared account';
  end if;

  select count(*)
  into requested_count
  from (
    select distinct item_id
    from unnest(coalesce(p_item_ids, '{}'::uuid[])) as requested_item(item_id)
  ) requested;

  if requested_count = 0 then
    raise exception 'Study session must contain at least one item';
  end if;

  select count(*)
  into matched_count
  from public.items
  where user_id = p_user_id
    and id = any(p_item_ids);

  if matched_count <> requested_count then
    raise exception 'One or more study items do not belong to this account';
  end if;

  update public.items
  set shown_count = public.items.shown_count + 1,
      last_shown_at = session_time
  where user_id = p_user_id
    and id = any(p_item_ids);

  insert into public.study_counters (user_id, create_count, updated_at)
  values (p_user_id, 1, session_time)
  on conflict (user_id) do update
  set create_count = public.study_counters.create_count + 1,
      updated_at = session_time;

  return query
  select public.items.*
  from public.items
  where user_id = p_user_id
    and id = any(p_item_ids);
end;
$$;

grant execute on function public.start_study_session(uuid, uuid[]) to anon, authenticated;

create or replace function public.increment_exam_question_usage(
  p_user_id uuid,
  p_question_ids uuid[]
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count int;
begin
  if p_user_id not in (
    '88d2c940-8702-41c9-8669-7b176f01c216'::uuid,
    'b5e519d5-c39c-4f27-849d-d0d46db9d134'::uuid
  ) then
    raise exception 'Invalid shared account';
  end if;

  update public.exam_questions
  set shown_count = shown_count + 1,
      last_shown_at = now()
  where user_id = p_user_id
    and id = any(p_question_ids);

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

grant execute on function public.increment_exam_question_usage(uuid, uuid[]) to anon, authenticated;

commit;
