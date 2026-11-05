-- Projects tile tests. Run on STAGING after db/core/seed-staging.sql and db/projects/001 to 005. Rolled back.
-- Inside the transaction the demo accounts are given the tile 'projects' (demo_admin as tile admin,
-- demo_user with 'edit') and the tile is switched on, so the tests do not depend on the admin page. Nothing stays.
begin;

do $$
begin
  if not exists (select 1 from core.tiles where id = 'projects') then
    raise exception 'Register the tile ''projects'' in Admin > Tiles first';
  end if;
end $$;
update core.tiles set enabled = true, rights = array['edit', 'review'] where id = 'projects';
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
declare v jsonb; n int; v_id uuid; v_note uuid; v_code text; v_year text := to_char(now(), 'YYYY');
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

  perform pg_temp.expect_error('select public.projects_products()', 'NOT_APPROVED');
  reset role;

  -- active, no tile
  perform pg_temp.act_as('demo_none');
  perform pg_temp.expect_error('select public.projects_lists()', 'NO_ACCESS');
  perform pg_temp.expect_error('select public.projects_products()', 'NO_ACCESS');
  perform pg_temp.expect_error('select public.projects_list(null, null, null)', 'NO_ACCESS');
  perform pg_temp.expect_error('select public.projects_create(''Sample Tower'', ''Consultant'', ''Sample Consultants'', ''UAE'')', 'NO_ACCESS');
  reset role;

  -- user with 'edit': lists, create, get, update
  perform pg_temp.act_as('demo_user');
  select public.projects_lists() into v;
  if jsonb_array_length(v -> 'regions') < 5 or jsonb_array_length(v -> 'client_types') < 3 then raise exception 'lists'; end if;
  select public.projects_products() into v;
  if jsonb_array_length(v) <> 3 or (v -> 0 ->> 'id') <> 'ahu' or jsonb_array_length(v -> 0 -> 'factories') <> 2
     or (v -> 0 -> 'factories' -> 0 ->> 'name') <> 'Dubai' then raise exception 'products: %', v; end if;

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
  if not core.has_tile((select id from t_ids where k = 'demo_admin'), 'projects', 'review') then raise exception 'admin holds review'; end if;
  if core.has_tile((select id from t_ids where k = 'demo_user'), 'projects', 'review') then raise exception 'user does not hold review'; end if;
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

  -- datasheets (005): row mapping, Product Options collection, tables saved in a project (invented values)
  perform pg_temp.act_as('demo_user');
  select public.projects_dn_rules('ahu') into v;
  if not (v ->> 'show_unmapped')::boolean or jsonb_array_length(v -> 'rules') <> 0 then raise exception 'dn_rules empty: %', v; end if;
  perform pg_temp.expect_error('select public.projects_dn_rules(''boiler'')', 'INVALID:product_id');
  select public.projects_dn_add_rows('ahu', '[{"key":"unit data||panel","section":"Unit Data","sub":"","component":"Panel"},
    {"key":"unit data||panel","section":"Unit Data","sub":"","component":"Panel"},
    {"key":"general||power supply","section":"General","sub":"","component":"Power Supply"},
    {"key":"filter supply||filter class","section":"Filter Supply","sub":"","component":"Filter Class"},
    {"key":"made up||row","section":"Made Up","sub":"","component":"Row"}]'::jsonb) into v;
  if (v ->> 'added')::int <> 4 then raise exception 'dn_add_rows added: %', v; end if;
  select public.projects_dn_add_rows('ahu', '[{"key":"unit data||panel","section":"Unit Data","sub":"","component":"Panel"}]'::jsonb) into v;
  if (v ->> 'added')::int <> 0 then raise exception 'dn_add_rows again'; end if;
  select public.projects_dn_rules('ahu') into v;
  if jsonb_array_length(v -> 'rules') <> 4 then raise exception 'dn_rules count'; end if;
  if (select x ->> 'strip' from jsonb_array_elements(v -> 'rules') x where x ->> 'key' = 'general||power supply') <> '+ PE' then raise exception 'starter strip'; end if;
  if (select x ->> 'keywords' from jsonb_array_elements(v -> 'rules') x where x ->> 'key' = 'unit data||panel') not like 'double wall;%' then raise exception 'starter keywords'; end if;
  if (select x ->> 'keywords' from jsonb_array_elements(v -> 'rules') x where x ->> 'key' = 'made up||row') <> '' then raise exception 'no starter for unknown row'; end if;
  if not (select bool_and((x ->> 'new')::boolean) from jsonb_array_elements(v -> 'rules') x) then raise exception 'new rows marked new'; end if;
  perform pg_temp.expect_error('select public.projects_dn_add_rows(''ahu'', ''{}''::jsonb)', 'INVALID:rows');

  select public.projects_po_collect('ahu', '[
    {"factory":"riyadh","key":"unit data||panel","value":"62 mm","model":"","grp":""},
    {"factory":"Riyadh","key":"unit data||panel","value":"62 mm","model":"","grp":""},
    {"factory":"Riyadh","key":"unit data||panel","value":"50 mm","model":"","grp":""},
    {"factory":"Riyadh","key":"filter supply||filter class","value":"ISO Coarse 60%(G4)","model":"","grp":"Filter Class: ISO Coarse 60%(G4)"},
    {"factory":"Riyadh","key":"filter supply||dimensions","value":"2x(592x592x48) 1x(287x592x48)","model":"","grp":"Filter Class: ISO Coarse 60%(G4)"},
    {"factory":"Riyadh","key":"general||project","value":"Sample Tower","model":"","grp":""},
    {"factory":"Riyadh","key":"made up||unseen","value":"x","model":"","grp":""},
    {"factory":"Shenzhen","key":"unit data||panel","value":"62 mm","model":"","grp":""}]'::jsonb) into v;
  if (v ->> 'saved')::int <> 3 then raise exception 'po_collect saved: %', v; end if;   -- panel 62, panel 50, filter class (dimensions row is not in the mapping)
  reset role;   -- the table itself is read as the owner: no page can
  if (select count(*) from projects.po_values) <> 3 then raise exception 'po_values rows'; end if;
  if (select times from projects.po_values where row_key = 'unit data||panel' and value_key = '62 mm') <> 2 then raise exception 'po_collect times'; end if;
  if (select bool_or(approved) from projects.po_values) then raise exception 'po_collect must not approve'; end if;
  perform pg_temp.act_as('demo_user');
  select public.projects_dn_add_rows('ahu', '[{"key":"filter supply||dimensions","section":"Filter Supply","sub":"","component":"Dimensions"}]'::jsonb) into v;
  select public.projects_po_collect('ahu', '[
    {"factory":"Riyadh","key":"unit data||panel","value":"62 mm","model":"","grp":""},
    {"factory":"Riyadh","key":"filter supply||dimensions","value":"2x(592x592x48) 1x(287x592x48)","model":"","grp":"Filter Class: ISO Coarse 60%(G4)"}]'::jsonb) into v;
  reset role;
  if (select times from projects.po_values where row_key = 'unit data||panel' and value_key = '62 mm') <> 3 then raise exception 'po_collect times again'; end if;
  if (select count(*) from projects.po_values where row_key = 'filter supply||dimensions') <> 2 then raise exception 'po_pieces'; end if;
  if (select string_agg(value, ',' order by value) from projects.po_values where row_key = 'filter supply||dimensions') <> '287x592x48,592x592x48' then raise exception 'po_pieces values'; end if;
  perform pg_temp.act_as('demo_user');
  perform pg_temp.expect_error('select public.projects_po_collect(''ahu'', ''"x"''::jsonb)', 'INVALID:items');

  select public.projects_note_save(v_id, 'ahu', 'sample-a.pdf', '["AHU-01","AHU-02"]'::jsonb,
    '[{"section":"General","component":"Power Supply","cells":["400 V / 3 / 50 Hz","400 V / 3 / 50 Hz"],"kind":"row","key":"general||power supply"},
      {"section":"","component":"Panel","cells":["62 mm","50 mm"],"marks":[0,1],"kind":"row","key":"unit data||panel"}]'::jsonb, 'Riyadh') into v;
  if (v ->> 'replaced')::int <> 0 or (v ->> 'factory_id') <> 'ahu-riyadh' then raise exception 'note_save: %', v; end if;
  select public.projects_note_save(v_id, 'ahu', 'sample-b.pdf', '["AHU-03"]'::jsonb,
    '[{"section":"General","component":"Power Supply","cells":["400 V / 3 / 50 Hz"],"kind":"row","key":"general||power supply"}]'::jsonb, 'Nowhere') into v;
  if (v ->> 'replaced')::int <> 0 or (v ->> 'factory_id') <> '' then raise exception 'note_save unknown factory: %', v; end if;
  select public.projects_get(v_id) into v;
  if jsonb_array_length(v -> 'notes') <> 2
     or (select x ->> 'units' from jsonb_array_elements(v -> 'notes') x where x ->> 'file_names' = 'sample-b.pdf') <> '1'
     or (select x ->> 'factory' from jsonb_array_elements(v -> 'notes') x where x ->> 'file_names' = 'sample-a.pdf') <> 'Riyadh' then raise exception 'get notes: %', v -> 'notes'; end if;
  if (v -> 'events' -> 0 ->> 'action') <> 'datasheet notes saved' then raise exception 'note event'; end if;
  -- read again with every unit of the first table (plus one): it replaces the first, not the second
  select public.projects_note_save(v_id, 'ahu', 'sample-a2.pdf', '["AHU-01","AHU-02","AHU-04"]'::jsonb,
    '[{"section":"General","component":"Power Supply","cells":["a","b","c"],"kind":"row","key":"general||power supply"}]'::jsonb, '') into v;
  if (v ->> 'replaced')::int <> 1 then raise exception 'note_save replaces: %', v; end if;
  select public.projects_get(v_id) into v;
  if jsonb_array_length(v -> 'notes') <> 2 or (v -> 'events' -> 0 ->> 'action') <> 'datasheet notes replaced' then raise exception 'replace event'; end if;
  select max(notes) into n from public.projects_list(v_code, null, null); if n <> 2 then raise exception 'list notes count'; end if;
  v_note := (select (x ->> 'id')::uuid from jsonb_array_elements(v -> 'notes') x where x ->> 'file_names' = 'sample-a2.pdf');
  select public.projects_note_get(v_note) into v;
  if (v ->> 'project') <> 'Sample Tower C' or (v ->> 'product') <> 'AHU' or jsonb_array_length(v -> 'columns') <> 3 or jsonb_array_length(v -> 'rows') <> 1 then raise exception 'note_get: %', v; end if;
  perform pg_temp.expect_error(format('select public.projects_note_get(%L)', gen_random_uuid()), 'NOT_FOUND');
  perform pg_temp.expect_error(format('select public.projects_note_save(%L, ''ahu'', ''x'', ''[]''::jsonb, ''[{}]''::jsonb, '''')', v_id), 'INVALID:columns');
  perform pg_temp.expect_error(format('select public.projects_note_save(%L, ''ahu'', ''x'', ''["A"]''::jsonb, ''[]''::jsonb, '''')', v_id), 'INVALID:rows');
  perform pg_temp.expect_error(format('select public.projects_note_save(%L, ''boat'', ''x'', ''["A"]''::jsonb, ''[{}]''::jsonb, '''')', v_id), 'INVALID:product_id');
  perform pg_temp.expect_error(format('select public.projects_note_save(%L, ''ahu'', ''x'', ''["A"]''::jsonb, ''[{}]''::jsonb, '''')', gen_random_uuid()), 'NOT_FOUND');
  reset role;
  -- another user (demo_none has the tile and 'edit' since the block above): the table is NOT_FOUND to read, save into or delete
  perform pg_temp.act_as('demo_none');
  perform pg_temp.expect_error(format('select public.projects_note_get(%L)', v_note), 'NOT_FOUND');
  perform pg_temp.expect_error(format('select public.projects_note_delete(%L)', v_note), 'NOT_FOUND');
  perform pg_temp.expect_error(format('select public.projects_note_save(%L, ''ahu'', ''x'', ''["A"]''::jsonb, ''[{}]''::jsonb, '''')', v_id), 'NOT_FOUND');
  reset role;
  -- a reader (no right): sees the table, cannot add rows, collect, save or delete
  update core.tile_access set rights = '{}' where tile_id = 'projects' and user_id = (select id from t_ids where k = 'demo_user');
  perform pg_temp.act_as('demo_user');
  select public.projects_note_get(v_note) into v; if (v ->> 'id') is null then raise exception 'reader reads own table'; end if;
  perform pg_temp.expect_error('select public.projects_dn_add_rows(''ahu'', ''[]''::jsonb)', 'NO_RIGHT');
  perform pg_temp.expect_error('select public.projects_po_collect(''ahu'', ''[]''::jsonb)', 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.projects_note_delete(%L)', v_note), 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.projects_note_save(%L, ''ahu'', ''x'', ''["A"]''::jsonb, ''[{}]''::jsonb, '''')', v_id), 'NO_RIGHT');
  reset role;
  update core.tile_access set rights = array['edit'] where tile_id = 'projects' and user_id = (select id from t_ids where k = 'demo_user');
  -- the admin opens and deletes any
  perform pg_temp.act_as('demo_admin');
  perform public.projects_note_delete(v_note);
  select public.projects_get(v_id) into v;
  if jsonb_array_length(v -> 'notes') <> 1 or (v -> 'events' -> 0 ->> 'action') <> 'datasheet notes deleted' then raise exception 'note_delete'; end if;
  reset role;

  -- sharing (003): only a tile admin or the super user shares; a member sees, opens and edits, cannot share on
  perform pg_temp.act_as('demo_user'); -- creator, not an admin
  perform pg_temp.expect_error(format('select public.projects_share_get(%L)', v_id), 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.projects_share_set(%L, array[%L]::uuid[])', v_id, (select id from t_ids where k = 'demo_none')), 'NO_RIGHT');
  reset role;
  perform pg_temp.act_as('demo_none'); -- not yet a member
  perform pg_temp.expect_error(format('select public.projects_share_get(%L)', v_id), 'NOT_FOUND');
  reset role;
  perform pg_temp.act_as('demo_admin');
  select public.projects_share_get(v_id) into v;
  if jsonb_array_length(v -> 'members') <> 0 or (v ->> 'created_by_name') <> 'demo_user' then raise exception 'share_get empty'; end if;
  if not (v ? 'users') or not (v ? 'core_missing') then raise exception 'share_get shape'; end if;
  perform pg_temp.expect_error(format('select public.projects_share_set(%L, array[%L]::uuid[])', v_id, (select id from t_ids where k = 'demo_pending')), 'INVALID:user_ids');
  perform pg_temp.expect_error(format('select public.projects_share_set(%L, array[%L]::uuid[])', v_id, gen_random_uuid()), 'INVALID:user_ids');
  select public.projects_share_set(v_id, array[(select id from t_ids where k = 'demo_none'), (select id from t_ids where k = 'demo_user')]) into v;
  if (v ->> 'members')::int <> 1 or (v ->> 'added')::int <> 1 then raise exception 'share_set adds one, never the creator: %', v; end if;
  select public.projects_share_set(v_id, array[(select id from t_ids where k = 'demo_none')]) into v;
  if (v ->> 'added')::int <> 0 or (v ->> 'removed')::int <> 0 then raise exception 'share_set same list, no change'; end if;
  select public.projects_get(v_id) into v;
  if jsonb_array_length(v -> 'members') <> 1 or (v -> 'members' -> 0 ->> 'username') <> 'demo_none' then raise exception 'get members'; end if;
  if (v -> 'events' -> 0 ->> 'action') <> 'shared with' or (v -> 'events' -> 0 ->> 'detail') <> '@demo_none' then raise exception 'share event: %', v -> 'events' -> 0; end if;
  if not (v ->> 'can_share')::boolean then raise exception 'admin can_share'; end if;
  select max(members) into n from public.projects_list(v_code, null, null); if n <> 1 then raise exception 'list members count'; end if;
  reset role;
  perform pg_temp.act_as('demo_none'); -- member with 'edit': sees, opens, edits; cannot share
  select count(*) into n from public.projects_list(null, null, null); if n <> 2 then raise exception 'member sees own + shared: %', n; end if;
  select public.projects_get(v_id) into v; if (v ->> 'can_share')::boolean then raise exception 'member can_share'; end if;
  perform public.projects_update(v_id, 'Sample Tower D', 'Contractor', 'Sample Consultants', 'UAE');
  perform pg_temp.expect_error(format('select public.projects_share_get(%L)', v_id), 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.projects_share_set(%L, ''{}''::uuid[])', v_id), 'NO_RIGHT');
  reset role;
  perform pg_temp.act_as('demo_admin'); -- sharing ended
  select public.projects_share_set(v_id, '{}'::uuid[]) into v;
  if (v ->> 'removed')::int <> 1 then raise exception 'share_set removes'; end if;
  select public.projects_get(v_id) into v;
  if (v -> 'events' -> 0 ->> 'action') <> 'sharing ended for' then raise exception 'unshare event'; end if;
  reset role;
  perform pg_temp.act_as('demo_none');
  select count(*) into n from public.projects_list(null, null, null); if n <> 1 then raise exception 'ex-member sees own only'; end if;
  perform pg_temp.expect_error(format('select public.projects_get(%L)', v_id), 'NOT_FOUND');
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
