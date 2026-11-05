-- Projects tile tests. Run on STAGING after db/core/seed-staging.sql and db/projects/001 to 010. Rolled back.
-- Inside the transaction the demo accounts are given the tile 'projects' (demo_admin as tile admin,
-- demo_user with no right: since 009 the tile alone lets a user create and work in his projects) and the tile is switched on, so the tests do not depend on the admin page. Nothing stays.
begin;

do $$
begin
  if not exists (select 1 from core.tiles where id = 'projects') then
    raise exception 'Register the tile ''projects'' in Admin > Tiles first';
  end if;
end $$;
update core.tiles set enabled = true, rights = array['review'] where id = 'projects';
insert into core.tile_access (user_id, tile_id, is_admin, rights)
  select p.id, 'projects', true, '{}' from core.profiles p where p.username = 'demo_admin' on conflict do nothing;
insert into core.tile_access (user_id, tile_id, is_admin, rights)
  select p.id, 'projects', false, '{}' from core.profiles p where p.username = 'demo_user' on conflict do nothing;

create temp table t_ids as select username k, id from core.profiles where username in ('demo_admin','demo_user','demo_none','demo_pending');
grant select on t_ids to public;

create or replace function pg_temp.act_as(p_key text) returns void language plpgsql as $$
declare v_id uuid; v_sid uuid := gen_random_uuid();
begin
  execute 'reset role';
  if p_key is null then perform set_config('request.jwt.claims', '', true); perform set_config('role', 'anon', true); return; end if;
  select id into v_id from t_ids where k = p_key;
  insert into auth.sessions (id, user_id, created_at, updated_at) values (v_sid, v_id, now(), now()); -- as Supabase Auth at sign-in
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
declare v jsonb; n int; v_n2 int; v_id uuid; v_note uuid; v_run uuid; v_run2 uuid; v_line uuid; v_code text; v_year text := to_char(now(), 'YYYY');
begin
  -- signed out: nothing
  perform pg_temp.act_as(null);
  perform pg_temp.expect_error('select public.projects_lists()', 'PERMISSION');
  perform pg_temp.expect_error('select public.projects_list(null, null, null)', 'PERMISSION');
  reset role;

  -- pending: refused before anything else
  perform pg_temp.act_as('demo_pending');
  perform pg_temp.expect_error('select public.projects_lists()', 'NOT_APPROVED');
  perform pg_temp.expect_error('select public.projects_settings_get()', 'NOT_APPROVED');
  reset role;

  perform pg_temp.expect_error('select public.projects_products()', 'NOT_APPROVED');
  reset role;

  -- active, no tile
  perform pg_temp.act_as('demo_none');
  perform pg_temp.expect_error('select public.projects_lists()', 'NO_ACCESS');
  perform pg_temp.expect_error('select public.projects_products()', 'NO_ACCESS');
  perform pg_temp.expect_error('select public.projects_list(null, null, null)', 'NO_ACCESS');
  perform pg_temp.expect_error('select public.projects_create(''Sample Tower'', ''Consultant'', ''Sample Consultants'', ''UAE'')', 'NO_ACCESS');
  perform pg_temp.expect_error('select public.projects_settings_get()', 'NO_ACCESS');
  perform pg_temp.expect_error('select public.projects_settings_save(''{"max_clauses": 2}''::jsonb)', 'NO_ACCESS');
  perform pg_temp.expect_error('select public.projects_settings_history(10)', 'NO_ACCESS');
  reset role;

  -- a plain user (the tile, no right): lists, create, get, update
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

  -- another plain user with the tile: only his own projects; another user's record is NOT_FOUND
  insert into core.tile_access (user_id, tile_id, is_admin, rights)
    select id, 'projects', false, '{}' from t_ids where k = 'demo_none';
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
  -- another user (demo_none has the tile since the block above): the table is NOT_FOUND to read, save into or delete
  perform pg_temp.act_as('demo_none');
  perform pg_temp.expect_error(format('select public.projects_note_get(%L)', v_note), 'NOT_FOUND');
  perform pg_temp.expect_error(format('select public.projects_note_delete(%L)', v_note), 'NOT_FOUND');
  perform pg_temp.expect_error(format('select public.projects_note_save(%L, ''ahu'', ''x'', ''["A"]''::jsonb, ''[{}]''::jsonb, '''')', v_id), 'NOT_FOUND');
  reset role;
  -- the tile alone (009): adds rows and collects without any right; a table that is not his stays NOT_FOUND
  perform pg_temp.act_as('demo_user');
  select public.projects_note_get(v_note) into v; if (v ->> 'id') is null then raise exception 'user reads own table'; end if;
  select public.projects_dn_add_rows('ahu', '[]'::jsonb) into v; if (v ->> 'added')::int <> 0 then raise exception 'add_rows empty: %', v; end if;
  select public.projects_po_collect('ahu', '[]'::jsonb) into v; if (v ->> 'saved')::int <> 0 then raise exception 'po_collect empty: %', v; end if;
  perform pg_temp.expect_error(format('select public.projects_note_delete(%L)', gen_random_uuid()), 'NOT_FOUND');
  reset role;
  -- the admin opens and deletes any
  perform pg_temp.act_as('demo_admin');
  perform public.projects_note_delete(v_note);
  select public.projects_get(v_id) into v;
  if jsonb_array_length(v -> 'notes') <> 1 or (v -> 'events' -> 0 ->> 'action') <> 'datasheet notes deleted' then raise exception 'note_delete'; end if;
  reset role;

  -- specifications (006): convert, library, answers, review flag, split / join, upload, export (invented clauses)
  perform pg_temp.act_as('demo_user');
  perform pg_temp.expect_error(format('select public.projects_run_save(%L, ''ahu-riyadh'', ''pdf'', ''x.pdf'', ''[]''::jsonb)', v_id), 'INVALID:lines');
  perform pg_temp.expect_error(format('select public.projects_run_save(%L, ''ahu-nowhere'', ''pdf'', ''x.pdf'', ''[{"type":"text","spec":"x"}]''::jsonb)', v_id), 'INVALID:factory_id');
  perform pg_temp.expect_error(format('select public.projects_run_save(%L, ''ahu-riyadh'', ''pdf'', ''x.pdf'', ''[{"type":"text","spec":"x"}]''::jsonb)', gen_random_uuid()), 'NOT_FOUND');
  select public.projects_run_save(v_id, 'ahu-riyadh', 'pdf', 'sample-spec.pdf', '[
    {"type":"part","sr":"","spec":"PART 2 - PRODUCTS"},
    {"type":"section","sr":"2.1","spec":"UNIT CASINGS"},
    {"type":"letter","sr":"A.","spec":"Casing panels shall be double skin with 50 mm insulation between the skins."},
    {"type":"number","sr":"1.","spec":"Inner skin shall be galvanised steel of 0.7 mm thickness."},
    {"type":"text","sr":"","spec":"Short"},
    {"type":"letter","sr":"B.","spec":"Casing panels shall be double skin with 50 mm insulation between the skins."},
    {"type":"section","sr":"2.2","spec":"FILTERS"},
    {"type":"letter","sr":"A.","spec":"Pre filters shall be ISO Coarse 60% (G4) washable type."}]'::jsonb) into v;
  v_run := (v ->> 'run_id')::uuid;
  if (v ->> 'lines')::int <> 8 or (v ->> 'unique_lines')::int <> 3 or (v ->> 'matched')::int <> 0 or jsonb_array_length(v -> 'answers') <> 0 then raise exception 'run_save: %', v; end if;
  select public.projects_run_get(v_run) into v;
  if (v -> 'run' ->> 'factory') <> 'Riyadh' or (v -> 'run' ->> 'project_code') <> v_code or (v -> 'run' ->> 'can_comment')::boolean or (v -> 'run' ->> 'can_review')::boolean then raise exception 'run_get run: %', v -> 'run'; end if;
  if jsonb_array_length(v -> 'lines') <> 8 or (v -> 'lines' -> 2 ->> 'can')::boolean is not true or (v -> 'lines' -> 4 ->> 'can')::boolean is not false then raise exception 'run_get lines'; end if;
  if (v -> 'lines' -> 5 ->> 'can')::boolean is not true then raise exception 'repeated clause is answerable'; end if;
  -- answers: the project's own, review pending; the same as the library (none yet) would be ''
  select public.projects_run_save_line(v_run, 2, 'Comply', '', 'casingpanelsshallbedoubleskinwith50mmins') into v;
  if (v ->> 'review') <> 'pending' then raise exception 'save_line review: %', v; end if;
  perform pg_temp.expect_error(format('select public.projects_run_save_line(%L, 2, ''Comply'', '''', ''wrongkey'')', v_run), 'INVALID:check');
  perform pg_temp.expect_error(format('select public.projects_run_save_line(%L, 4, ''Comply'', '''', null)', v_run), 'INVALID:seq');
  perform pg_temp.expect_error(format('select public.projects_run_save_line(%L, 2, ''Comply'', '''', null)', gen_random_uuid()), 'NOT_FOUND');
  select public.projects_run_fill_section(v_run, 1, 'Noted', false, null) into v;
  if (v ->> 'filled')::int <> 2 or (v ->> 'kept')::int <> 1 then raise exception 'fill_section: %', v; end if;   -- A already answered and kept; 1. and B filled
  select public.projects_run_fill_section(v_run, 1, 'Not Applicable', true, null) into v;
  if (v ->> 'filled')::int <> 3 then raise exception 'fill_section replace: %', v; end if;
  select public.projects_run_fill_section(v_run, 1, '', false, null) into v;
  if (v ->> 'filled')::int <> 3 then raise exception 'fill_section clear: %', v; end if;
  perform pg_temp.expect_error(format('select public.projects_run_fill_section(%L, 2, ''Noted'', false, null)', v_run), 'INVALID:seq');
  perform public.projects_run_save_line(v_run, 2, 'Comply', '', null);
  -- TL Review needs a tile admin; Internal Comments need the review right
  perform pg_temp.expect_error(format('select public.projects_run_save_review(%L, 2, ''check this'', null)', v_run), 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.projects_run_save_comment(%L, 2, ''note # rule'', null)', v_run), 'NO_RIGHT');
  reset role;
  perform pg_temp.act_as('demo_admin');
  perform public.projects_run_save_review(v_run, 2, 'check this', null);
  perform public.projects_run_save_comment(v_run, 2, 'note for users # rule for reviewers', null);
  select public.projects_run_get(v_run) into v;
  if (v -> 'lines' -> 2 ->> 'tl_review') <> 'check this' or (v -> 'lines' -> 2 ->> 'lib_comments') <> 'note for users # rule for reviewers' then raise exception 'admin sees all comments: %', v -> 'lines' -> 2; end if;
  if (v -> 'lines' -> 5 ->> 'lib_comments') <> 'note for users # rule for reviewers' then raise exception 'comment is the clause''s, on every row'; end if;
  reset role;
  perform pg_temp.act_as('demo_user');
  select public.projects_run_get(v_run) into v;
  if (v -> 'lines' -> 2 ->> 'lib_comments') <> 'note for users' then raise exception 'user sees the note only: %', v -> 'lines' -> 2 ->> 'lib_comments'; end if;
  if (v -> 'lines' -> 2 ->> 'by') <> 'demo_user' then raise exception 'answered by'; end if;
  -- split: the words must not change; the first row keeps its answer (back to review), the new rows enter the library
  perform pg_temp.expect_error(format('select public.projects_run_split(%L, 3, ''[{"type":"text","spec":"Inner skin shall be galvanised steel"},{"type":"text","spec":"of 0.8 mm thickness."}]''::jsonb, null)', v_run), 'INVALID:rows');
  select public.projects_run_split(v_run, 3, '[{"type":"text","spec":"Inner skin shall be galvanised steel"},{"type":"text","sr":"","spec":"of 0.7 mm thickness."}]'::jsonb, null) into v;
  if (v ->> 'rows')::int <> 2 then raise exception 'split'; end if;
  select public.projects_run_get(v_run) into v;
  if jsonb_array_length(v -> 'lines') <> 9 or (v -> 'lines' -> 3 ->> 'spec') <> 'Inner skin shall be galvanised steel' or (v -> 'lines' -> 4 ->> 'spec') <> 'of 0.7 mm thickness.' or (v -> 'lines' -> 4 ->> 'can')::boolean is not true then raise exception 'split rows: %', v -> 'lines'; end if;
  if (v -> 'lines' -> 7 ->> 'spec') <> 'FILTERS' then raise exception 'split shifted the rows'; end if;
  -- join the second part back; the row above keeps label and type; the words return
  perform public.projects_run_join(v_run, 4, null);
  select public.projects_run_get(v_run) into v;
  if jsonb_array_length(v -> 'lines') <> 8 or (v -> 'lines' -> 3 ->> 'spec') <> 'Inner skin shall be galvanised steel of 0.7 mm thickness.' or (v -> 'lines' -> 3 ->> 'sr') <> '1.' then raise exception 'join: %', v -> 'lines' -> 3; end if;
  perform pg_temp.expect_error(format('select public.projects_run_join(%L, 1, null)', v_run), 'INVALID:join');   -- into a PART row
  reset role;
  if (select count(*) from projects.lines where factory_id = 'ahu-riyadh') <> 3 then raise exception 'library lines after split/join: %', (select count(*) from projects.lines); end if;
  perform pg_temp.act_as('demo_user');
  -- a second record of the same factory: the library already holds the clauses; precedent needs 5 identical clauses (none here)
  select public.projects_run_save(v_id, 'ahu-riyadh', 'text', 'pasted', '[
    {"type":"letter","sr":"A.","spec":"Casing panels shall be double skin with 50 mm insulation between the skins."},
    {"type":"letter","sr":"B.","spec":"A brand new clause nobody has met before, long enough to count."}]'::jsonb) into v;
  v_run2 := (v ->> 'run_id')::uuid;
  if (v ->> 'unique_lines')::int <> 2 or (v ->> 'matched')::int <> 0 then raise exception 'second run: %', v; end if;   -- the library answer is not approved yet (step 4)
  if jsonb_array_length(v -> 'answers') <> 1 or (v -> 'answers' -> 0 ->> 'comments') <> 'note for users' then raise exception 'second run comments: %', v -> 'answers'; end if;
  reset role;
  if (select times_seen from projects.lines where norm_text = projects.cm_norm('Casing panels shall be double skin with 50 mm insulation between the skins.')) <> 2 then raise exception 'times_seen'; end if;
  perform pg_temp.act_as('demo_user');
  -- upload of a filled Excel: the answers land by text; the second run gets its answer
  select public.projects_run_submit_answers(v_run2, '[{"spec":"A brand new clause nobody has met before, long enough to count.","compliance":"Not Comply","remarks":"x"},{"spec":"unknown clause","compliance":"Comply","remarks":""}]'::jsonb) into v;
  if (v ->> 'stored')::int <> 1 or (v ->> 'pending')::int <> 1 then raise exception 'submit: %', v; end if;
  -- the project page: two records with their counts; the list counts runs and pending answers
  select public.projects_get(v_id) into v;
  if jsonb_array_length(v -> 'runs') <> 2 then raise exception 'get runs'; end if;
  if (select (x ->> 'answered')::int from jsonb_array_elements(v -> 'runs') x where x ->> 'file_name' = 'sample-spec.pdf') <> 1 then raise exception 'get run counts: %', v -> 'runs'; end if;
  select max(runs), max(pending) into n, v_n2 from public.projects_list(v_code, null, null); if n <> 2 or v_n2 <> 2 then raise exception 'list runs/pending: % %', n, v_n2; end if;
  -- export: every row with the answer that applies
  select public.projects_export(v_id) into v;
  if jsonb_array_length(v -> 'runs') <> 2 or jsonb_array_length(v -> 'compliance') <> 10 or jsonb_array_length(v -> 'tables') <> 1 then raise exception 'export: % % %', jsonb_array_length(v -> 'runs'), jsonb_array_length(v -> 'compliance'), jsonb_array_length(v -> 'tables'); end if;
  if (select x ->> 'source' from jsonb_array_elements(v -> 'compliance') x where x ->> 'spec' = 'A brand new clause nobody has met before, long enough to count.') <> 'Project answer, waiting for review' then raise exception 'export source'; end if;
  -- approved Product Options: none approved yet
  select public.projects_po_approved('ahu-riyadh') into v;
  if jsonb_array_length(v -> 'values') <> 0 or (v ->> 'factory') <> 'Riyadh' then raise exception 'po_approved: %', v; end if;
  perform pg_temp.expect_error('select public.projects_po_approved(''nowhere'')', 'INVALID:factory_id');
  -- the record leaves the project; pending answers are withdrawn; the library keeps the clause
  perform public.projects_run_delete(v_run2);
  perform pg_temp.expect_error(format('select public.projects_run_get(%L)', v_run2), 'NOT_FOUND');
  select public.projects_get(v_id) into v;
  if jsonb_array_length(v -> 'runs') <> 1 or (v -> 'events' -> 0 ->> 'action') <> 'compliance record removed' then raise exception 'run_delete'; end if;
  reset role;
  if (select review from projects.run_lines where run_id = v_run2 and seq = 1) <> '' then raise exception 'pending withdrawn'; end if;
  if (select count(*) from projects.lines where factory_id = 'ahu-riyadh') <> 4 then raise exception 'library keeps the clauses'; end if;
  -- another user: the record is NOT_FOUND; the creator (no right) fills it
  perform pg_temp.act_as('demo_none');
  perform pg_temp.expect_error(format('select public.projects_run_get(%L)', v_run), 'NOT_FOUND');
  perform pg_temp.expect_error(format('select public.projects_run_save_line(%L, 2, ''Comply'', '''', null)', v_run), 'NOT_FOUND');
  perform pg_temp.expect_error(format('select public.projects_export(%L)', v_id), 'NOT_FOUND');
  reset role;
  perform pg_temp.act_as('demo_user');
  select public.projects_run_get(v_run) into v; if not (v -> 'run' ->> 'can_edit')::boolean then raise exception 'creator can_edit'; end if;
  select public.projects_export(v_id) into v; if (v -> 'project' ->> 'code') <> v_code then raise exception 'creator exports'; end if;
  perform pg_temp.expect_error(format('select public.projects_run_delete(%L)', gen_random_uuid()), 'NOT_FOUND');
  reset role;

  -- compliance review (007): the library for reviewers; an approved answer becomes the library's and pre-fills the record
  perform pg_temp.act_as('demo_user');                       -- no right: no Compliance review
  perform pg_temp.expect_error('select public.projects_lib_lines(''ahu-riyadh'')', 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.projects_review_decide(%L, 2, ''approve'')', v_run), 'NO_RIGHT');
  perform pg_temp.expect_error('select public.projects_lib_import(''ahu-riyadh'', ''x.xlsx'', ''[{}]''::jsonb)', 'NO_RIGHT');
  perform pg_temp.expect_error('select public.projects_lib_export(''ahu-riyadh'')', 'NO_RIGHT');
  perform pg_temp.expect_error('select public.projects_lib_runs()', 'NO_RIGHT');
  perform pg_temp.expect_error('select public.projects_lib_reset(''ahu'')', 'NO_RIGHT');
  reset role;
  perform pg_temp.act_as('demo_admin');                      -- tile admin: holds 'review'
  perform pg_temp.expect_error('select public.projects_lib_lines(''ahu-nowhere'')', 'INVALID:factory_id');
  select public.projects_lib_lines('ahu-riyadh', 'review') into v;
  if (v -> 'counts' ->> 'all')::int <> 4 or (v -> 'counts' ->> 'open')::int <> 4 or (v -> 'counts' ->> 'review')::int <> 1 then raise exception 'lib counts: %', v -> 'counts'; end if;
  if (v ->> 'total')::int <> 1 or (v -> 'lines' -> 0 -> 'project_answers' -> 0 ->> 'review') <> 'pending' or (v -> 'lines' -> 0 -> 'project_answers' -> 0 ->> 'code') <> v_code
     or (v -> 'lines' -> 0 -> 'project_answers' -> 0 ->> 'by') <> 'demo_user' then raise exception 'lib review lines: %', v -> 'lines'; end if;
  v_line := (v -> 'lines' -> 0 ->> 'id')::uuid;
  select public.projects_lib_lines('ahu-riyadh', 'all') into v;
  if (v ->> 'total')::int <> 4 or (v -> 'lines' -> 0 ->> 'part')::int <> 2 or (v -> 'lines' -> 0 ->> 'topic') <> 'Casing and base' then raise exception 'lib all / order: %', v -> 'lines' -> 0; end if;
  if jsonb_array_length(v -> 'project_codes') <> 1 or jsonb_array_length(v -> 'groups') < 2 then raise exception 'lib lists: % %', v -> 'project_codes', v -> 'groups'; end if;
  select public.projects_lib_lines('ahu-riyadh', 'all', '', null, '', '', '', v_code) into v;
  if (v ->> 'total')::int <> 3 then raise exception 'lib by project code: %', v ->> 'total'; end if;
  select public.projects_lib_lines('ahu-riyadh', 'all', '', null, 'Filters') into v;
  if (v ->> 'total')::int <> 1 then raise exception 'lib by topic'; end if;
  select public.projects_lib_lines('ahu-riyadh', 'all', 'inner skin') into v;
  if (v ->> 'total')::int <> 1 then raise exception 'lib search'; end if;
  select public.projects_lib_lines('ahu-riyadh', 'all', '', 2, '', 'Consultant') into v;      -- the client type of the project changed to Contractor earlier
  if (v ->> 'total')::int <> 0 then raise exception 'lib client type'; end if;
  -- decide: the line the reviewer saw must still be the row's; approve; the record then shows the library answer (green)
  perform pg_temp.expect_error(format('select public.projects_review_decide(%L, 2, ''approve'', %L)', v_run, gen_random_uuid()), 'INVALID:check');
  perform pg_temp.expect_error(format('select public.projects_review_decide(%L, 2, ''maybe'')', v_run), 'INVALID:decision');
  perform pg_temp.expect_error(format('select public.projects_review_decide(%L, 3, ''approve'')', v_run), 'NOT_FOUND');      -- nothing waiting there
  perform public.projects_review_decide(v_run, 2, 'approve', v_line);
  select public.projects_lib_lines('ahu-riyadh', 'answered') into v;
  if (v ->> 'total')::int <> 1 or (v -> 'lines' -> 0 ->> 'compliance') <> 'Comply' or (v -> 'lines' -> 0 ->> 'answer_source') <> 'approved' then raise exception 'approved into library: %', v -> 'lines'; end if;
  if (v -> 'counts' ->> 'review')::int <> 0 then raise exception 'nothing left to review'; end if;
  reset role;
  perform pg_temp.act_as('demo_user');
  select public.projects_run_get(v_run) into v;
  if (v -> 'lines' -> 2 ->> 'review') <> 'approved' then raise exception 'row approved: %', v -> 'lines' -> 2; end if;
  if (v -> 'lines' -> 5 ->> 'lib_compliance') <> 'Comply' or (v -> 'lines' -> 5 ->> 'own')::boolean then raise exception 'green pre-fill on the repeated clause: %', v -> 'lines' -> 5; end if;
  select public.projects_run_save_line(v_run, 5, 'Comply', '', null) into v;
  if (v ->> 'review') <> '' then raise exception 'equal to the library needs no review'; end if;
  select public.projects_run_save_line(v_run, 5, 'Not Comply', 'other', null) into v;              -- differs from the library: waits
  if (v ->> 'review') <> 'pending' then raise exception 'differs: pending'; end if;
  select public.projects_run_save_line(v_run, 7, 'Comply with Remarks', 'G4 washable', null) into v;
  select public.projects_get(v_id) into v;
  if (select (x ->> 'approved')::int from jsonb_array_elements(v -> 'runs') x) <> 1 then raise exception 'project page approved count'; end if;
  reset role;
  perform pg_temp.act_as('demo_admin');
  -- a library line that already has another answer is never overwritten from a project
  perform pg_temp.expect_error(format('select public.projects_review_decide(%L, 5, ''approve'')', v_run), 'INVALID:answered');
  perform public.projects_review_decide(v_run, 5, 'reject');
  -- approved as corrected here
  perform public.projects_review_decide(v_run, 7, 'approve', null, 'Comply', '');
  select public.projects_lib_lines('ahu-riyadh', 'all', 'pre filters') into v;
  if (v -> 'lines' -> 0 ->> 'compliance') <> 'Comply' or (v -> 'lines' -> 0 ->> 'remarks') <> '' then raise exception 'approved as corrected: %', v -> 'lines' -> 0; end if;
  select public.projects_get(v_id) into v;
  if (v -> 'events' -> 0 ->> 'action') <> 'answer approved for the library' or (v -> 'events' -> 1 ->> 'action') <> 'answer not taken into the library' then raise exception 'review events: %', v -> 'events' -> 0; end if;
  -- the reviewer's own answers and Internal Comments
  select (x ->> 'id')::uuid into v_line from jsonb_array_elements((public.projects_lib_lines('ahu-riyadh', 'open')) -> 'lines') x where x ->> 'spec_text' like 'Inner skin%';
  select public.projects_lib_save_answer(v_line, 'Comply with Remarks', 'Galvanised 0.7 mm', 'note for users # for reviewers') into v;
  if (v ->> 'status') <> 'answered' then raise exception 'lib_save_answer'; end if;
  select public.projects_lib_save_answer(v_line, '', '', null) into v;
  if (v ->> 'status') <> 'open' then raise exception 'lib_save_answer clears'; end if;
  perform pg_temp.expect_error(format('select public.projects_lib_save_answer(%L, ''Comply'', '''')', gen_random_uuid()), 'NOT_FOUND');
  -- upload a filled library (invented clauses): standard words, last row wins, short rows skipped, replaced counted
  select public.projects_lib_import('ahu-riyadh', 'library.xlsx', '[
    {"spec":"Units shall be shipped on a base frame with lifting holes.","compliance":"by contractor","remarks":"","sr":"A","type":"letter","part":"1","section":"DELIVERY","section_sr":"1.5"},
    {"spec":"Units shall be shipped on a base frame with lifting holes.","compliance":"Complied","remarks":"","sr":"A","type":"letter","part":"1","section":"DELIVERY","section_sr":"1.5"},
    {"spec":"Pre filters shall be ISO Coarse 60% (G4) washable type.","compliance":"Comply with Remarks","remarks":"Washable G4","sr":"A"},
    {"spec":"Short","compliance":"Comply"},
    {"spec":"A clause with only an internal comment for the users.","compliance":"","remarks":"","comments":"read the IOM"}]'::jsonb) into v;
  if (v ->> 'added')::int <> 1 or (v ->> 'replaced')::int <> 1 or (v ->> 'skipped')::int <> 3 or (v ->> 'standardised')::int <> 2 then raise exception 'lib_import: %', v; end if;
  select public.projects_lib_lines('ahu-riyadh', 'all', 'base frame') into v;
  if (v -> 'lines' -> 0 ->> 'compliance') <> 'Comply' or (v -> 'lines' -> 0 ->> 'part')::int <> 1 or (v -> 'lines' -> 0 ->> 'section') <> 'DELIVERY' then raise exception 'imported line: %', v -> 'lines' -> 0; end if;
  perform pg_temp.expect_error('select public.projects_lib_import(''ahu-riyadh'', ''x'', ''[]''::jsonb)', 'INVALID:rows');
  -- export (whole factory, and one project in its order) and the history
  select public.projects_lib_export('ahu-riyadh') into v;
  if jsonb_array_length(v -> 'lines') <> 6 or (v -> 'lines' -> 0 ->> 'part')::int <> 1 then raise exception 'lib_export: %', jsonb_array_length(v -> 'lines'); end if;
  select public.projects_lib_export('ahu-riyadh', lower(v_code)) into v;
  if jsonb_array_length(v -> 'lines') <> 3 or (v -> 'lines' -> 0 -> 'project_codes' ->> 0) <> v_code then raise exception 'lib_export by code: %', v; end if;
  select public.projects_lib_runs() into v;
  if (v ->> 'total')::int <> 3 or not exists (select 1 from jsonb_array_elements(v -> 'runs') x where x ->> 'kind' = 'library-upload' and x ->> 'file_name' = 'library.xlsx') then raise exception 'lib_runs: %', v; end if;
  -- a junk line leaves the library; the record row that held it can no longer be answered
  select (x ->> 'id')::uuid into v_line from jsonb_array_elements((public.projects_lib_lines('ahu-riyadh', 'all', 'only an internal comment')) -> 'lines') x;
  perform public.projects_lib_delete_line(v_line);
  perform pg_temp.expect_error(format('select public.projects_lib_delete_line(%L)', v_line), 'NOT_FOUND');
  -- clean a library: the super user only
  perform pg_temp.expect_error('select public.projects_lib_reset(''ahu'', ''ahu-riyadh'')', 'NO_RIGHT');
  reset role;
  update core.profiles set is_super = true where id = (select id from t_ids where k = 'demo_admin');
  perform pg_temp.act_as('demo_admin');
  perform pg_temp.expect_error('select public.projects_lib_reset(''boat'')', 'INVALID:product_id');
  select public.projects_lib_reset('ahu', 'ahu-riyadh', false) into v;
  if (v ->> 'records_removed')::int <> 0 or (v ->> 'history_removed')::int <> 2 then raise exception 'lib_reset: %', v; end if;
  select public.projects_lib_lines('ahu-riyadh', 'all') into v;
  if (v -> 'counts' ->> 'answered')::int <> 0 or (v -> 'counts' ->> 'all')::int <> (v -> 'counts' ->> 'open')::int then raise exception 'reset empties the answers: %', v -> 'counts'; end if;
  if (v -> 'counts' ->> 'review')::int < 1 then raise exception 'reset sends the users'' answers back to review'; end if;
  reset role;
  update core.profiles set is_super = false where id = (select id from t_ids where k = 'demo_admin');

  -- Product Options (008). Riyadh has panel 62 / 50 mm, filter class G4 and two filter sizes, all waiting.
  perform pg_temp.act_as('demo_user');   -- no right: reads the approved values, changes nothing
  select public.projects_po_tree('ahu-riyadh') into v;
  if (v ->> 'can_edit')::boolean or (v ->> 'can_approve')::boolean or jsonb_array_length(v -> 'sections') <> 0 then raise exception 'po_tree user flags: %', v; end if;
  if (select count(*) from jsonb_array_elements(v -> 'rows') r, jsonb_array_elements(r -> 'values') x) <> 0 then raise exception 'po_tree user sees waiting values'; end if;
  if (v -> 'factory' ->> 'product') <> 'AHU' or (v -> 'factory' ->> 'name') <> 'Riyadh' then raise exception 'po_tree factory'; end if;
  perform pg_temp.expect_error('select public.projects_po_tree(''nowhere'')', 'INVALID:factory_id');
  perform pg_temp.expect_error('select public.projects_po_approve(''ahu-riyadh'', null, true, true)', 'NO_RIGHT');
  perform pg_temp.expect_error('select public.projects_po_save_extra(''ahu-riyadh'', null, ''Unit Data'', '''', ''note'', ''x'')', 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.projects_po_delete_extra(%L)', gen_random_uuid()), 'NO_RIGHT');
  perform pg_temp.expect_error('select public.projects_po_set_hidden(''ahu-riyadh'', ''unit data||panel'', ''62 mm'', '''', '''', true)', 'NO_RIGHT');
  perform pg_temp.expect_error('select public.projects_po_set_rows_hidden(''ahu-riyadh'', ''["unit data||panel"]'', true)', 'NO_RIGHT');
  perform pg_temp.expect_error('select public.projects_po_set_place(''ahu-riyadh'', ''["unit data||panel"]'', ''general'', '''')', 'NO_RIGHT');
  perform pg_temp.expect_error('select public.projects_po_set_kind(''ahu-riyadh'', ''["unit data||panel"]'', ''duty'')', 'NO_RIGHT');
  perform pg_temp.expect_error('select public.projects_po_clear_ungrouped(''ahu-riyadh'', ''Unit Data'', null, null)', 'NO_RIGHT');
  perform pg_temp.expect_error('select public.projects_po_reset(''ahu'', null, false)', 'NO_RIGHT');
  perform pg_temp.expect_error('select public.projects_dn_save_rules(''ahu'', ''[]'', ''[]'', true)', 'NO_RIGHT');
  reset role;
  perform pg_temp.act_as('demo_pending');
  perform pg_temp.expect_error('select public.projects_po_tree(''ahu-riyadh'')', 'NOT_APPROVED');
  reset role;
  perform pg_temp.act_as(null);
  perform pg_temp.expect_error('select public.projects_po_tree(''ahu-riyadh'')', 'PERMISSION');
  reset role;

  perform pg_temp.act_as('demo_admin');   -- tile admin: holds 'review'
  select public.projects_po_tree('ahu-riyadh') into v;
  if not (v ->> 'can_approve')::boolean then raise exception 'po_tree admin can_approve'; end if;
  if (select count(*) from jsonb_array_elements(v -> 'rows') r, jsonb_array_elements(r -> 'values') x where not (x ->> 'approved')::boolean) <> 5 then raise exception 'po_tree admin sees the 5 waiting values: %', v -> 'rows'; end if;
  if not (v -> 'sections' ? 'Unit Data') or (v -> 'sections' ? 'General') then raise exception 'po_tree sections: %', v -> 'sections'; end if;
  select public.projects_po_approve('ahu-riyadh', '[{"key":"unit data||panel","model":"","grp":"","value_key":"62 mm"}]', false, true) into v;
  if (v ->> 'changed')::int <> 1 then raise exception 'approve one'; end if;
  perform pg_temp.expect_error('select public.projects_po_approve(''ahu-riyadh'', ''[{"key":"unit data||panel","model":"","grp":"","value_key":"62 mm"}]'', false, true)', 'INVALID:nothing');
  perform pg_temp.expect_error('select public.projects_po_approve(''ahu-riyadh'', ''[]'', false, true)', 'INVALID:items');
  select public.projects_po_approve('ahu-riyadh', '[{"key":"unit data||panel","model":"","grp":"","value_key":"50 mm"}]', false, false) into v;
  if (v ->> 'changed')::int <> 1 then raise exception 'reject one'; end if;
  select public.projects_po_save_extra('ahu-riyadh', null, ' Unit  Data ', 'unit data||panel', 'option', ' 75 mm panel on request ') into v;
  v_line := (v ->> 'id')::uuid;
  perform public.projects_po_save_extra('ahu-riyadh', v_line, 'Unit Data', 'unit data||panel', 'option', '75 mm panel on request (confirm with the factory)');
  perform public.projects_po_save_extra('ahu-riyadh', null, 'Fan Supply', 'family:EC Fans', 'make', 'Sample Fans Ltd');
  perform pg_temp.expect_error('select public.projects_po_save_extra(''ahu-riyadh'', null, ''Unit Data'', '''', ''ai'', ''x'')', 'INVALID:kind');
  perform pg_temp.expect_error('select public.projects_po_save_extra(''ahu-riyadh'', null, ''Unit Data'', '''', ''note'', ''  '')', 'INVALID:body');
  perform pg_temp.expect_error('select public.projects_po_save_extra(''ahu-riyadh'', null, '''', '''', ''note'', ''x'')', 'INVALID:section');
  perform pg_temp.expect_error(format('select public.projects_po_save_extra(''ahu-riyadh'', null, ''Fan'', '''', ''make'', %L)', repeat('x', 121)), 'INVALID:make');
  perform pg_temp.expect_error(format('select public.projects_po_save_extra(''ahu-riyadh'', %L, ''Unit Data'', '''', ''note'', ''x'')', gen_random_uuid()), 'NOT_FOUND');
  perform pg_temp.expect_error(format('select public.projects_po_save_extra(''ahu-dubai'', %L, ''Unit Data'', '''', ''note'', ''x'')', v_line), 'NOT_FOUND');   -- another factory's entry
  reset role;
  perform pg_temp.act_as('demo_user');   -- now sees the approved value and the special options
  select public.projects_po_tree('ahu-riyadh') into v;
  if (select string_agg(x ->> 'v', ',') from jsonb_array_elements(v -> 'rows') r, jsonb_array_elements(r -> 'values') x) <> '62 mm' then raise exception 'user sees the approved value only: %', v -> 'rows'; end if;
  -- both extras were saved in this one transaction (same time), so their order is by id: find the option by its kind
  if jsonb_array_length(v -> 'extras') <> 2 or not exists (select 1 from jsonb_array_elements(v -> 'extras') x
       where x ->> 'kind' = 'option' and x ->> 'body' = '75 mm panel on request (confirm with the factory)'
         and x ->> 'section' = 'Unit Data' and x ->> 'by' = 'demo_admin') then raise exception 'extras: %', v -> 'extras'; end if;
  select public.projects_po_approved('ahu-riyadh') into v;
  if jsonb_array_length(v -> 'values') <> 1 then raise exception 'po_approved after approval'; end if;
  reset role;
  perform pg_temp.act_as('demo_admin');
  perform public.projects_po_set_hidden('ahu-riyadh', 'unit data||panel', '62 mm', '', '', true);
  perform pg_temp.expect_error('select public.projects_po_set_hidden(''ahu-riyadh'', ''unit data||panel'', ''99 mm'', '''', '''', true)', 'NOT_FOUND');
  reset role;
  perform pg_temp.act_as('demo_user');
  select public.projects_po_approved('ahu-riyadh') into v;
  if jsonb_array_length(v -> 'values') <> 0 then raise exception 'a value taken out is not offered'; end if;
  reset role;
  perform pg_temp.act_as('demo_admin');
  perform public.projects_po_set_hidden('ahu-riyadh', 'unit data||panel', '62 mm', '', '', false);
  select public.projects_po_set_rows_hidden('ahu-riyadh', '["filter supply||filter class", " filter supply||filter class "]', true) into v;
  if (v ->> 'changed')::int <> 1 then raise exception 'rows hidden: %', v; end if;
  perform pg_temp.expect_error('select public.projects_po_set_rows_hidden(''ahu-riyadh'', ''[]'', true)', 'INVALID:row_keys');
  perform pg_temp.expect_error('select public.projects_po_set_rows_hidden(''ahu-riyadh'', ''["no such row"]'', true)', 'NOT_FOUND');
  select public.projects_po_tree('ahu-riyadh') into v;
  if not (select (r ->> 'hidden')::boolean from jsonb_array_elements(v -> 'rows') r where r ->> 'key' = 'filter supply||filter class') then raise exception 'admin sees the left-out row'; end if;
  reset role;
  perform pg_temp.act_as('demo_user');
  select public.projects_po_tree('ahu-riyadh') into v;
  if exists (select 1 from jsonb_array_elements(v -> 'rows') r where r ->> 'key' = 'filter supply||filter class') then raise exception 'user never sees a left-out row'; end if;
  reset role;
  perform pg_temp.act_as('demo_admin');
  perform public.projects_po_set_rows_hidden('ahu-riyadh', '["filter supply||filter class"]', false);
  perform public.projects_po_set_place('ahu-riyadh', '["unit data||panel"]', 'general', '');
  perform public.projects_po_set_place('ahu-riyadh', '["unit data||panel"]', 'model', 'FWWVA');
  perform pg_temp.expect_error('select public.projects_po_set_place(''ahu-riyadh'', ''["unit data||panel"]'', ''left'', '''')', 'INVALID:place');
  perform public.projects_po_set_kind('ahu-riyadh', '["unit data||panel"]', 'duty');
  perform pg_temp.expect_error('select public.projects_po_set_kind(''ahu-riyadh'', ''["unit data||panel"]'', ''accessory'')', 'INVALID:kind');
  select public.projects_po_tree('ahu-riyadh') into v;
  if (select r ->> 'kind_set' || '/' || (r ->> 'place') from jsonb_array_elements(v -> 'rows') r where r ->> 'key' = 'unit data||panel') <> 'duty/general' then raise exception 'kind and place'; end if;
  if (v -> 'series_place' -> 0 ->> 'series') <> 'FWWVA' or (v -> 'series_place' -> 0 ->> 'place') <> 'model' then raise exception 'series place: %', v -> 'series_place'; end if;
  perform public.projects_po_set_place('ahu-riyadh', '["unit data||panel"]', '', 'FWWVA');
  perform public.projects_po_set_kind('ahu-riyadh', '["unit data||panel"]', '');
  select public.projects_po_tree('ahu-riyadh') into v;
  if jsonb_array_length(v -> 'series_place') <> 0 then raise exception 'series place removed'; end if;
  select public.projects_po_clear_ungrouped('ahu-riyadh', 'Filter Supply', '[{"key":"filter supply||dimensions","grp":"Filter Class: ISO Coarse 60%(G4)"}]', null) into v;
  if (v ->> 'removed')::int <> 2 then raise exception 'clear_ungrouped drop: %', v; end if;
  perform pg_temp.expect_error('select public.projects_po_clear_ungrouped(''ahu-riyadh'', ''Unit Data'', null, null)', 'INVALID:nothing');
  perform pg_temp.expect_error('select public.projects_po_clear_ungrouped(''ahu-riyadh'', '' '', null, null)', 'INVALID:section');
  select public.projects_po_approve('ahu-riyadh', null, true, true) into v;
  if (v ->> 'changed')::int <> 1 then raise exception 'approve all: %', v; end if;   -- the filter class
  perform pg_temp.expect_error('select public.projects_po_approve(''ahu-riyadh'', null, true, true)', 'INVALID:nothing');
  perform public.projects_po_delete_extra(v_line);
  -- the row mapping
  select public.projects_dn_save_rules('ahu',
    '[{"key":"unit data||panel","section":"Unit Data","sub":"","component":"Panel","show":true,"label":"Panel thickness","strip":"","response":"","keywords":"double wall; panel","kind":"option","place":"model"},
      {"key":"new section||row","section":"New Section","sub":"","component":"Row","show":false,"label":"","strip":"","response":"","keywords":""},
      {"key":"new section||row","section":"Twice","sub":"","component":"Row"}]',
    '["made up||row"]', false) into v;
  if (v ->> 'saved')::int <> 2 or (v ->> 'removed')::int <> 1 then raise exception 'dn_save_rules: %', v; end if;
  select public.projects_dn_rules('ahu') into v;
  if (v ->> 'show_unmapped')::boolean then raise exception 'show_unmapped saved'; end if;
  if exists (select 1 from jsonb_array_elements(v -> 'rules') x where x ->> 'key' = 'made up||row') then raise exception 'removed row'; end if;
  if (select x ->> 'label' || '|' || (x ->> 'kind') || '|' || (x ->> 'place') || '|' || (x ->> 'new') from jsonb_array_elements(v -> 'rules') x where x ->> 'key' = 'unit data||panel')
     <> 'Panel thickness|option|model|false' then raise exception 'saved rule: %', v -> 'rules'; end if;
  if (select (x ->> 'show') || '|' || (x ->> 'section') || '|' || (x ->> 'keywords') from jsonb_array_elements(v -> 'rules') x where x ->> 'key' = 'new section||row')
     <> 'false|New Section|' then raise exception 'new rule, first of a repeated key wins'; end if;
  -- a rule without kind keeps the stored kind
  perform public.projects_dn_save_rules('ahu', '[{"key":"unit data||panel","section":"Unit Data","component":"Panel","label":"Panel thickness","keywords":"double wall; panel"}]', '[]', false);
  select public.projects_dn_rules('ahu') into v;
  if (select x ->> 'kind' from jsonb_array_elements(v -> 'rules') x where x ->> 'key' = 'unit data||panel') <> 'option' then raise exception 'kind kept'; end if;
  -- starter keywords for rows new to a mapping that has none (FCU), once
  perform public.projects_dn_save_rules('fcu', '[{"key":"general||power supply","section":"General","component":"Power Supply"}]', '[]', true);
  select public.projects_dn_rules('fcu') into v;
  if (v -> 'rules' -> 0 ->> 'keywords') not like 'power supply;%' then raise exception 'starter keywords on save: %', v; end if;
  perform pg_temp.expect_error('select public.projects_dn_save_rules(''ahu'', ''[{"key":"x","kind":"accessory"}]'', ''[]'', true)', 'INVALID:rules');
  perform pg_temp.expect_error('select public.projects_dn_save_rules(''ahu'', ''[{"key":""}]'', ''[]'', true)', 'INVALID:rules');
  perform pg_temp.expect_error('select public.projects_dn_save_rules(''boiler'', ''[]'', ''[]'', true)', 'INVALID:product_id');
  perform pg_temp.expect_error('select public.projects_po_reset(''ahu'', null, true)', 'NO_RIGHT');   -- a tile admin is not the super user
  reset role;
  update core.profiles set is_super = true where id = (select id from t_ids where k = 'demo_admin');
  perform pg_temp.act_as('demo_admin');
  perform pg_temp.expect_error('select public.projects_po_reset(''ahu'', ''fcu-riyadh'', true)', 'INVALID:factory_id');
  select public.projects_po_reset('ahu', 'ahu-riyadh', true) into v;
  if (v ->> 'values_removed')::int <> 2 or (v ->> 'extras_removed')::int <> 1 then raise exception 'po_reset: %', v; end if;
  reset role;
  update core.profiles set is_super = false where id = (select id from t_ids where k = 'demo_admin');
  if (select count(*) from projects.dn_map where product_id = 'ahu') = 0 then raise exception 'reset keeps the mapping'; end if;

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
  perform pg_temp.act_as('demo_none'); -- member: sees, opens, edits; cannot share
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

  -- a user with the tile and no right (009): creates a project, sees his own only, the knowledge base stays closed
  perform pg_temp.act_as('demo_user');
  select count(*) into n from public.projects_list(null, null, null); if n <> 1 then raise exception 'user sees own: %', n; end if;
  select public.projects_create('Sample Depot', 'Consultant', 'Sample Consultants', 'UAE') into v;
  if (v ->> 'code') not like 'P-' || v_year || '-%' then raise exception 'plain user creates: %', v; end if;
  select count(*) into n from public.projects_list(null, null, null); if n <> 2 then raise exception 'user sees his new one: %', n; end if;
  perform public.projects_update((v ->> 'id')::uuid, 'Sample Depot B', 'Consultant', 'Sample Consultants', 'UAE');
  perform pg_temp.expect_error('select public.projects_lib_lines(''ahu-riyadh'')', 'NO_RIGHT');   -- the knowledge base stays closed
  reset role;


  -- Matching rules (010): everyone with the tile reads them, only 'review' changes them; the built-in values pass the checks
  perform pg_temp.act_as(null);
  perform pg_temp.expect_error('select public.projects_settings_get()', 'PERMISSION');
  perform pg_temp.expect_error('select public.projects_settings_save(''{"max_clauses": 2}''::jsonb)', 'PERMISSION');
  reset role;
  v := '{"topics":[{"id":"vfd","words":["variable frequency","variable speed","frequency controller","frequency controllers","vfd","vfds","vfc","vfcs","inverter","inverters"]},{"id":"filter","words":["filter","filters","filtration","hepa","merv"]},{"id":"humid","words":["humidif*","washer","washers","evaporative"]},{"id":"heatpipe","words":["heat pipe","heat pipes","horseshoe","wrap around"]},{"id":"recovery","words":["energy recovery","heat recovery","heat wheel","heat wheels","energy wheel","energy wheels","enthalpy wheel","enthalpy wheels","recuperator","recuperators","heat exchanger","heat exchangers","run around"]},{"id":"heater","words":["heater","heaters","electric heat*","electrical heat*","heating coil","heating coils","coil heating","coils heating"]},{"id":"coil","words":["coil","coils"]},{"id":"damper","words":["damper","dampers","mixing box","mixing boxes","mixing section","mixing sections"]},{"id":"attenuator","words":["attenuator","attenuators","silencer","silencers"]},{"id":"sound","words":["sound","acoustic*","noise"]},{"id":"fan","words":["fan","fans","motor","motors","drive","drives","impeller","impellers"]},{"id":"casing","words":["casing","casings","cabinet","cabinets","panel","panels","insulation","drain pan","drain pans","door","doors","roof","roofs","base","bases","frame","frames","structural"]},{"id":"electrical","words":["electrical","power supply","wiring","voltage"]},{"id":"performance","words":["capacity","capacities","characteristics","performance"]}],"general_topics":["casing","performance"],"section_topics":[{"section":"unit data","how":"is","topics":["casing","performance"]},{"section":"mechanical characteristic","how":"starts","topics":["casing"]},{"section":"en 13053","how":"starts","topics":["performance","fan"]}],"parts":[2,1],"near_words":6,"max_clauses":3,"keep_share":50,"heading_words":8,"heading_verbs":["shall","must","will","should"],"label_chars":80,"properties":[{"name":"panel thickness","terms":["panel thickness","casing thickness","panel","casing","skin","wall thickness"],"direction":"higher","unit":"length","scale":[]},{"name":"insulation thickness","terms":["insulation","insulated","foam","polyurethane","mineral wool","rock wool"],"direction":"higher","unit":"length","scale":[]},{"name":"sheet or tube thickness","terms":["gauge","sheet thickness","tube thickness","fin thickness","wall of tube"],"direction":"higher","unit":"length","scale":[]},{"name":"density","terms":["density"],"direction":"higher","unit":"","scale":[]},{"name":"thermal transmittance (U value)","terms":["u value","u-value","thermal transmittance","thermal conductance","conductance","w/m2k","w/m²k"],"direction":"lower","unit":"u_value","scale":[]},{"name":"pressure drop","terms":["pressure drop","pressure loss","air side resistance","resistance"],"direction":"lower","unit":"pressure","scale":[]},{"name":"air leakage","terms":["leakage","leak","air tightness"],"direction":"lower","unit":"","scale":[]},{"name":"sound level","terms":["sound power","sound pressure","sound level","noise","acoustic level"],"direction":"lower","unit":"","scale":[]},{"name":"air velocity","terms":["face velocity","velocity","air speed"],"direction":"lower","unit":"velocity","scale":[]},{"name":"specific fan power","terms":["specific fan power","sfp"],"direction":"lower","unit":"","scale":[]},{"name":"efficiency","terms":["efficiency","efficient","cop","eer","iplv","nplv","seer"],"direction":"higher","unit":"","scale":[]},{"name":"capacity","terms":["capacity","cooling capacity","heating capacity","duty"],"direction":"higher","unit":"power","scale":[]},{"name":"air flow","terms":["air flow","airflow","air volume","flow rate"],"direction":"higher","unit":"flow","scale":[]},{"name":"motor power","terms":["absorbed power","power input","power consumption","motor power"],"direction":"lower","unit":"power","scale":[]},{"name":"warranty","terms":["warranty","guarantee"],"direction":"higher","unit":"time","scale":[]},{"name":"electrical supply","terms":["voltage","power supply","electrical supply","phase","volt"],"direction":"exact","unit":"","scale":[]},{"name":"connection size","terms":["connection size","connection","nozzle","flange size"],"direction":"exact","unit":"length","scale":[]},{"name":"thermal bridging class (EN 1886)","terms":["thermal bridging","thermal bridge","tb class","tb"],"direction":"higher","unit":"","scale":["TB5","TB4","TB3","TB2","TB1"]},{"name":"thermal transmittance class (EN 1886)","terms":["thermal transmittance class","transmittance class","thermal transmittance","thermal transmit","t class"],"direction":"higher","unit":"","scale":["T5","T4","T3","T2","T1"]},{"name":"casing strength class (EN 1886)","terms":["mechanical strength","casing strength","deflection","d class"],"direction":"higher","unit":"","scale":["D3","D2","D1"]},{"name":"casing leakage class (EN 1886)","terms":["casing leakage","casing air leakage","air leakage class","leakage class","l class"],"direction":"higher","unit":"","scale":["L3","L2","L1"]},{"name":"filter class (EN 779)","terms":["filter class","filtration","filter","filters"],"direction":"higher","unit":"","scale":["G1","G2","G3","G4","M5","M6","F7","F8","F9","E10","E11","E12","H10","H11","H12","H13","H14","U15","U16","U17"]}],"figure_words":8,"option_values":40,"candidates_shown":12,"choose_listed":3}'::jsonb;      -- assets/pr-settings.js, PRSettings.DEFAULTS: keep equal when the built-in values change
  select count(*) into n from jsonb_each(v) e where projects.settings_check(e.key, e.value) <> '';
  if n <> 0 then raise exception 'built-in values refused: %', (select string_agg(e.key || ': ' || projects.settings_check(e.key, e.value), '; ') from jsonb_each(v) e where projects.settings_check(e.key, e.value) <> ''); end if;
  if jsonb_typeof(v) <> 'object' or (select count(*) from jsonb_object_keys(v)) <> 15 then raise exception 'built-in keys: %', (select count(*) from jsonb_object_keys(v)); end if;
  perform pg_temp.act_as('demo_user');           -- the tile, no right
  select public.projects_settings_get() into v;
  if jsonb_array_length(v -> 'settings') <> 0 or (v ->> 'can_review')::boolean then raise exception 'settings_get for a user: %', v; end if;
  perform pg_temp.expect_error('select public.projects_settings_save(''{"max_clauses": 2}''::jsonb)', 'NO_RIGHT');
  perform pg_temp.expect_error('select public.projects_settings_history(10)', 'NO_RIGHT');
  reset role;
  perform pg_temp.act_as('demo_admin');          -- tile admin: holds 'review'
  select public.projects_settings_get() into v;
  if not (v ->> 'can_review')::boolean then raise exception 'admin can review'; end if;
  select public.projects_settings_save('{"max_clauses": 2, "parts": [2], "topics": [{"id": "filter", "words": ["filter*", "hepa"]}, {"id": "wheel", "words": ["plate wheel", "heat wheel*"]}]}'::jsonb) into v;
  if (v -> 'changed') <> '["max_clauses", "parts", "topics"]'::jsonb then raise exception 'save changed: %', v; end if;
  select public.projects_settings_save('{"max_clauses": 2}'::jsonb) into v;          -- the same value: no change, no history line
  if jsonb_array_length(v -> 'changed') <> 0 then raise exception 'equal value is no change'; end if;
  select public.projects_settings_save('{"max_clauses": 4, "parts": null}'::jsonb) into v;      -- null = back to the built-in value
  if (v -> 'changed') <> '["max_clauses", "parts"]'::jsonb then raise exception 'save 2: %', v; end if;
  select public.projects_settings_save('{"parts": null}'::jsonb) into v;              -- already built-in: nothing to do
  if jsonb_array_length(v -> 'changed') <> 0 then raise exception 'reset twice'; end if;
  select public.projects_settings_history(10) into v;
  if jsonb_array_length(v) <> 5 or (v -> 0 ->> 'key') not in ('max_clauses', 'parts') or (v -> 0 ->> 'by') <> 'demo_admin' then raise exception 'history: %', v; end if;
  if (select count(*) from jsonb_array_elements(v) h where h.value ->> 'key' = 'parts' and h.value -> 'new' = 'null'::jsonb and h.value -> 'old' = '[2]'::jsonb) <> 1 then raise exception 'history reset line'; end if;
  -- refused: unknown key, wrong shapes, out of range, nothing at all; nothing is saved when one value is wrong
  perform pg_temp.expect_error('select public.projects_settings_save(''{"colour": 1}''::jsonb)', 'INVALID:colour');
  perform pg_temp.expect_error('select public.projects_settings_save(''{"colour": null}''::jsonb)', 'INVALID:colour');
  perform pg_temp.expect_error('select public.projects_settings_save(''{"max_clauses": 0}''::jsonb)', 'INVALID:max_clauses');
  perform pg_temp.expect_error('select public.projects_settings_save(''{"max_clauses": 2.5}''::jsonb)', 'INVALID:max_clauses');
  perform pg_temp.expect_error('select public.projects_settings_save(''{"keep_share": "50"}''::jsonb)', 'INVALID:keep_share');
  perform pg_temp.expect_error('select public.projects_settings_save(''{"parts": [2, 2]}''::jsonb)', 'INVALID:parts');
  perform pg_temp.expect_error('select public.projects_settings_save(''{"parts": []}''::jsonb)', 'INVALID:parts');
  perform pg_temp.expect_error('select public.projects_settings_save(''{"topics": [{"id": "Filter", "words": ["filter"]}]}''::jsonb)', 'INVALID:topics');
  perform pg_temp.expect_error('select public.projects_settings_save(''{"topics": [{"id": "filter", "words": ["fil*ter"]}]}''::jsonb)', 'INVALID:topics');
  perform pg_temp.expect_error('select public.projects_settings_save(''{"topics": [{"id": "a", "words": ["x"]}, {"id": "a", "words": ["y"]}]}''::jsonb)', 'INVALID:topics');
  perform pg_temp.expect_error('select public.projects_settings_save(''{"section_topics": [{"section": "Unit Data", "how": "is", "topics": ["casing"]}]}''::jsonb)', 'INVALID:section_topics');
  perform pg_temp.expect_error('select public.projects_settings_save(''{"section_topics": [{"section": "unit data", "how": "like", "topics": ["casing"]}]}''::jsonb)', 'INVALID:section_topics');
  perform pg_temp.expect_error('select public.projects_settings_save(''{"heading_verbs": ["shall not"]}''::jsonb)', 'INVALID:heading_verbs');
  perform pg_temp.expect_error('select public.projects_settings_save(''{"properties": [{"name": "fin spacing", "terms": ["fin spacing"], "direction": "up", "unit": "", "scale": []}]}''::jsonb)', 'INVALID:properties');
  perform pg_temp.expect_error('select public.projects_settings_save(''{"properties": [{"name": "fin spacing", "terms": ["Fin Spacing"], "direction": "lower", "unit": "", "scale": []}]}''::jsonb)', 'INVALID:properties');
  perform pg_temp.expect_error('select public.projects_settings_save(''{"properties": [{"name": "x", "terms": ["x"], "direction": "lower", "unit": "smell", "scale": []}]}''::jsonb)', 'INVALID:properties');
  perform pg_temp.expect_error('select public.projects_settings_save(''{"properties": [{"name": "x", "terms": ["x"], "direction": "lower", "unit": "", "scale": ["ePM1 50%"]}]}''::jsonb)', 'INVALID:properties');
  perform pg_temp.expect_error('select public.projects_settings_save(''{"max_clauses": 5, "near_words": 99}''::jsonb)', 'INVALID:near_words');
  perform pg_temp.expect_error('select public.projects_settings_save(''{}''::jsonb)', 'INVALID:values');
  perform pg_temp.expect_error('select public.projects_settings_save(''[1]''::jsonb)', 'INVALID:values');
  perform pg_temp.expect_error('select public.projects_settings_save(null)', 'INVALID:values');
  select public.projects_settings_save('{"properties": [{"name": "fin spacing", "terms": ["fin spacing", "fpi"], "direction": "lower", "unit": "length", "scale": []}]}'::jsonb) into v;
  reset role;
  if (select value from projects.settings where key = 'max_clauses') <> '4'::jsonb then raise exception 'a refused save changed nothing'; end if;
  perform pg_temp.act_as('demo_user');           -- the user reads what the reviewers saved (the record uses it)
  select public.projects_settings_get() into v;
  if (select count(*) from jsonb_array_elements(v -> 'settings')) <> 3
     or (select s.value -> 'updated_by_name' from jsonb_array_elements(v -> 'settings') s where s.value ->> 'key' = 'max_clauses') <> '"demo_admin"' then raise exception 'user reads settings: %', v; end if;
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
