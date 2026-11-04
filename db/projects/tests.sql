-- Projects tile tests. Run on STAGING after db/core/seed-staging.sql, db/projects/001_init.sql and 002_visibility.sql. Rolled back.
-- Inside the transaction the demo accounts are given the tile 'projects' (demo_admin as tile admin,
-- demo_user with 'edit') and the tile is switched on, so the tests do not depend on the admin page. Nothing stays.
begin;

do $$
begin
  if not exists (select 1 from core.tiles where id = 'projects') then
    raise exception 'Register the tile ''projects'' in Admin > Tiles first';
  end if;
end $$;
update core.tiles set enabled = true, rights = array['edit'] where id = 'projects';
insert into core.tile_access (user_id, tile_id, is_admin, rights)
  select p.id, 'projects', true, '{}' from core.profiles p where p.username = 'demo_admin' on conflict do nothing;
insert into core.tile_access (user_id, tile_id, is_admin, rights)
  select p.id, 'projects', false, array['edit'] from core.profiles p where p.username = 'demo_user' on conflict do nothing;

create temp table t_ids as select username k, id from core.profiles where username in ('demo_admin','demo_user','demo_none','demo_pending');
grant select on t_ids to public;

create or replace function pg_temp.act_as(p_key text) returns void language plpgsql as $$
declare v_id uuid; v_sid uuid := gen_random_uuid();
begin
  if p_key is null then perform set_config('request.jwt.claims', '', true); perform set_config('role', 'anon', true); return; end if;
  select id into v_id from t_ids where k = p_key;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'session_id', v_sid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.core_session_start();
end $$;
create or replace function pg_temp.expect_error(p_sql text, p_code text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error % from: %', p_code, p_sql;
exception when others then
  if sqlerrm = p_code or (p_code = 'PERMISSION' and sqlstate = '42501') then return; end if;
  if sqlerrm like 'expected error%' then raise; end if;
  raise exception 'expected % but got % (%) from: %', p_code, sqlerrm, sqlstate, p_sql;
end $$;
grant execute on function pg_temp.act_as(text), pg_temp.expect_error(text, text) to public;

do $$
declare v jsonb; n int; v_id uuid; v_code text; v_year text := to_char(now(), 'YYYY');
begin
  -- signed out: nothing
  perform pg_temp.act_as(null);
  perform pg_temp.expect_error('select public.projects_lists()', 'PERMISSION');
  perform pg_temp.expect_error('select public.projects_list(null, null, null)', 'PERMISSION');
  reset role;

  -- pending: refused before anything else
  perform pg_temp.act_as('demo_pending');
  perform pg_temp.expect_error('select public.projects_lists()', 'NOT_APPROVED');
  reset role;

  -- active, no tile
  perform pg_temp.act_as('demo_none');
  perform pg_temp.expect_error('select public.projects_lists()', 'NO_ACCESS');
  perform pg_temp.expect_error('select public.projects_list(null, null, null)', 'NO_ACCESS');
  perform pg_temp.expect_error('select public.projects_create(''Sample Tower'', ''Consultant'', ''Sample Consultants'', ''UAE'')', 'NO_ACCESS');
  reset role;

  -- user with 'edit': lists, create, get, update
  perform pg_temp.act_as('demo_user');
  select public.projects_lists() into v;
  if jsonb_array_length(v -> 'regions') < 5 or jsonb_array_length(v -> 'client_types') < 3 then raise exception 'lists'; end if;

  select public.projects_create('  Sample Tower  ', 'Consultant', ' Sample Consultants ', 'UAE') into v;
  v_id := (v ->> 'id')::uuid; v_code := v ->> 'code';
  if v_code !~ ('^P-' || v_year || '-[0-9]{4}$') then raise exception 'code format: %', v_code; end if;

  perform pg_temp.expect_error('select public.projects_create('''', ''Consultant'', ''x'', ''UAE'')', 'INVALID:name');
  perform pg_temp.expect_error('select public.projects_create(''x'', ''Nobody'', ''x'', ''UAE'')', 'INVALID:client_type');
  perform pg_temp.expect_error('select public.projects_create(''x'', ''Consultant'', '''', ''UAE'')', 'INVALID:client_name');
  perform pg_temp.expect_error('select public.projects_create(''x'', ''Consultant'', ''x'', ''Mars'')', 'INVALID:region');

  select count(*) into n from public.projects_list(null, null, null); if n <> 1 then raise exception 'list all: %', n; end if;
  select count(*) into n from public.projects_list('sample', null, null); if n <> 1 then raise exception 'list by name'; end if;
  select count(*) into n from public.projects_list(v_code, null, null); if n <> 1 then raise exception 'list by code'; end if;
  select count(*) into n from public.projects_list(null, 'Qatar', null); if n <> 0 then raise exception 'list by region'; end if;
  select count(*) into n from public.projects_list(null, 'UAE', 'Consultant'); if n <> 1 then raise exception 'list by filters'; end if;
  select max(total) into n from public.projects_list(null, null, null); if n <> 1 then raise exception 'total'; end if;

  select public.projects_get(v_id) into v;
  if (v ->> 'name') <> 'Sample Tower' or (v ->> 'client_name') <> 'Sample Consultants' then raise exception 'get trims'; end if;
  if (v ->> 'created_by_name') <> 'demo_user' then raise exception 'get author'; end if;
  if jsonb_array_length(v -> 'events') <> 1 then raise exception 'get events'; end if;
  perform pg_temp.expect_error(format('select public.projects_get(%L)', gen_random_uuid()), 'NOT_FOUND');

  perform public.projects_update(v_id, 'Sample Tower', 'Consultant', 'Sample Consultants', 'UAE'); -- no change, no event
  perform public.projects_update(v_id, 'Sample Tower B', 'Contractor', 'Sample Consultants', 'UAE');
  select public.projects_get(v_id) into v;
  if (v ->> 'name') <> 'Sample Tower B' or (v ->> 'client_type') <> 'Contractor' then raise exception 'update'; end if;
  if (v ->> 'code') <> v_code then raise exception 'code changed'; end if;
  if jsonb_array_length(v -> 'events') <> 2 then raise exception 'update event'; end if;
  perform pg_temp.expect_error(format('select public.projects_update(%L, ''x'', ''Consultant'', ''x'', ''UAE'')', gen_random_uuid()), 'NOT_FOUND');
  reset role;

  -- tile admin without the right in his own row: every declared right of the tile; codes keep counting
  perform pg_temp.act_as('demo_admin');
  select public.projects_create('Second Sample', 'Government', 'Sample Ministry', 'Qatar') into v;
  if (v ->> 'code') <= v_code then raise exception 'code not increasing'; end if;
  select count(*) into n from public.projects_list(null, null, null); if n <> 2 then raise exception 'admin sees both'; end if;
  if not (select bool_and(sees_all) from public.projects_list(null, null, null)) then raise exception 'admin sees_all'; end if;
  select public.projects_get(v_id) into v; if (v ->> 'created_by_name') <> 'demo_user' then raise exception 'admin opens any'; end if;
  perform public.projects_update(v_id, 'Sample Tower C', 'Contractor', 'Sample Consultants', 'UAE'); -- admin edits any
  reset role;

  -- another plain user with the tile and 'edit': only his own projects; another user's record is NOT_FOUND
  insert into core.tile_access (user_id, tile_id, is_admin, rights)
    select id, 'projects', false, array['edit'] from t_ids where k = 'demo_none';
  perform pg_temp.act_as('demo_none');
  select count(*) into n from public.projects_list(null, null, null); if n <> 0 then raise exception 'other user sees nothing: %', n; end if;
  perform pg_temp.expect_error(format('select public.projects_get(%L)', v_id), 'NOT_FOUND');
  perform pg_temp.expect_error(format('select public.projects_update(%L, ''x'', ''Consultant'', ''x'', ''UAE'')', v_id), 'NOT_FOUND');
  select public.projects_create('Third Sample', 'Contractor', 'Sample Builders', 'Oman') into v;
  select count(*) into n from public.projects_list(null, null, null); if n <> 1 then raise exception 'other user sees own'; end if;
  if (select bool_or(sees_all) from public.projects_list(null, null, null)) then raise exception 'user sees_all'; end if;
  reset role;
  delete from core.tile_access where tile_id = 'projects' and user_id = (select id from t_ids where k = 'demo_none');

  -- a user with the tile but no right: reads, cannot write
  update core.tile_access set rights = '{}' where tile_id = 'projects' and user_id = (select id from t_ids where k = 'demo_user');
  perform pg_temp.act_as('demo_user');
  select count(*) into n from public.projects_list(null, null, null); if n <> 1 then raise exception 'reader sees own: %', n; end if;
  perform pg_temp.expect_error('select public.projects_create(''x'', ''Consultant'', ''x'', ''UAE'')', 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.projects_update(%L, ''x'', ''Consultant'', ''x'', ''UAE'')', v_id), 'NO_RIGHT');
  reset role;

  -- tile switched off: refused for everyone but the super user
  update core.tiles set enabled = false where id = 'projects';
  perform pg_temp.act_as('demo_admin');
  perform pg_temp.expect_error('select public.projects_list(null, null, null)', 'NO_ACCESS');
  reset role;

  select count(*) into n from core.security_check(); if n <> 0 then raise exception 'security_check reports % problem(s)', n; end if;
  raise notice 'ALL PROJECTS TESTS PASSED';
end $$;

rollback;
