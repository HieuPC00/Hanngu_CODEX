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

notify pgrst, 'reload schema';
