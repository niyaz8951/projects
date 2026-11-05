-- Projects tile tests. Run on STAGING after db/core/seed-staging.sql and db/projects/001 to 006. Rolled back.
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
declare v jsonb; n int; v_n2 int; v_id uuid; v_note uuid; v_run uuid; v_run2 uuid; v_code text; v_year text := to_char(now(), 'YYYY');
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
  -- another user: the record is NOT_FOUND; a reader: reads, cannot write
  perform pg_temp.act_as('demo_none');
  perform pg_temp.expect_error(format('select public.projects_run_get(%L)', v_run), 'NOT_FOUND');
  perform pg_temp.expect_error(format('select public.projects_run_save_line(%L, 2, ''Comply'', '''', null)', v_run), 'NOT_FOUND');
  perform pg_temp.expect_error(format('select public.projects_export(%L)', v_id), 'NOT_FOUND');
  reset role;
  update core.tile_access set rights = '{}' where tile_id = 'projects' and user_id = (select id from t_ids where k = 'demo_user');
  perform pg_temp.act_as('demo_user');
  select public.projects_run_get(v_run) into v; if (v -> 'run' ->> 'can_edit')::boolean then raise exception 'reader can_edit'; end if;
  select public.projects_export(v_id) into v; if (v -> 'project' ->> 'code') <> v_code then raise exception 'reader exports'; end if;
  perform pg_temp.expect_error(format('select public.projects_run_save_line(%L, 2, ''Comply'', '''', null)', v_run), 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.projects_run_fill_section(%L, 1, ''Noted'', false, null)', v_run), 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.projects_run_split(%L, 3, ''[]''::jsonb, null)', v_run), 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.projects_run_join(%L, 3, null)', v_run), 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.projects_run_delete(%L)', v_run), 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.projects_run_submit_answers(%L, ''[{}]''::jsonb)', v_run), 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.projects_run_save(%L, ''ahu-riyadh'', ''pdf'', ''x'', ''[{"type":"text","spec":"x"}]''::jsonb)', v_id), 'NO_RIGHT');
  reset role;
  update core.tile_access set rights = array['edit'] where tile_id = 'projects' and user_id = (select id from t_ids where k = 'demo_user');

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
