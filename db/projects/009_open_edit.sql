-- Projects tile, 009: no 'edit' right any more (owner, 2026-11-05).
-- Everyone with the tile creates projects and works in the projects he may open (his own, the ones shared with him;
-- tile admins and the super user: every project). Who sees which project is unchanged (projects.can_open).
-- The knowledge base stays with the right 'review': Compliance review, Product Options, the row mapping.
-- Each function below is the latest definition from the file named above it, with core.require_tile('projects', 'edit')
-- turned into core.require_tile('projects', null), and run_get's can_edit always true (the caller opened the project).
-- Nothing else in the bodies changes. Run after 008. After it, take 'edit' out of the tile's rights in Admin > Tiles.

-- from 001_init.sql
-- Anyone with the tile: create a project. The code is P-<year>-<number>, the number from a counter that only goes up.
create or replace function public.projects_create(p_name text, p_client_type text, p_client_name text, p_region text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_id uuid; v_n integer; v_code text;
begin
  v_user := core.require_tile('projects', null);
  perform projects.check_fields(p_name, p_client_type, p_client_name, p_region);
  update projects.counters set value = value + 1 where name = 'project' returning value into v_n;
  v_code := 'P-' || to_char(now(), 'YYYY') || '-' || lpad(v_n::text, 4, '0');
  insert into projects.projects (code, name, client_type, client_name, region, created_by, created_by_name, updated_by, updated_by_name)
  values (v_code, trim(p_name), p_client_type, trim(p_client_name), p_region, v_user.id, v_user.username, v_user.id, v_user.username)
  returning id into v_id;
  insert into projects.events (project_id, user_id, username, action, detail)
  values (v_id, v_user.id, v_user.username, 'created', '');
  perform core.audit('projects', 'project_create', jsonb_build_object('id', v_id, 'code', v_code));
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;
revoke execute on function public.projects_create(text, text, text, text) from public, anon;
grant execute on function public.projects_create(text, text, text, text) to authenticated;

-- from 003_members.sql
-- Anyone with the tile, own, shared or admin: change the details. The code never changes. Every changed field is one line of history.
create or replace function public.projects_update(p_id uuid, p_name text, p_client_type text, p_client_name text, p_region text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_old projects.projects; v_changes text[] := '{}';
begin
  v_user := core.require_tile('projects', null);
  perform projects.check_fields(p_name, p_client_type, p_client_name, p_region);
  select * into v_old from projects.projects p where p.id = p_id;
  if not found or not projects.can_open(v_user, v_old) then raise exception 'NOT_FOUND'; end if;
  if v_old.name <> trim(p_name) then v_changes := v_changes || ('name: ' || v_old.name || ' -> ' || trim(p_name)); end if;
  if v_old.client_type <> p_client_type then v_changes := v_changes || ('client type: ' || v_old.client_type || ' -> ' || p_client_type); end if;
  if v_old.client_name <> trim(p_client_name) then v_changes := v_changes || ('client: ' || v_old.client_name || ' -> ' || trim(p_client_name)); end if;
  if v_old.region <> p_region then v_changes := v_changes || ('region: ' || v_old.region || ' -> ' || p_region); end if;
  if array_length(v_changes, 1) is null then return; end if;
  update projects.projects
     set name = trim(p_name), client_type = p_client_type, client_name = trim(p_client_name), region = p_region,
         updated_by = v_user.id, updated_by_name = v_user.username, updated_at = now()
   where id = p_id;
  insert into projects.events (project_id, user_id, username, action, detail)
  values (p_id, v_user.id, v_user.username, 'details changed', left(array_to_string(v_changes, '; '), 400));
  perform core.audit('projects', 'project_update', jsonb_build_object('id', p_id));
end $$;
revoke execute on function public.projects_update(uuid, text, text, text, text) from public, anon;
grant execute on function public.projects_update(uuid, text, text, text, text) to authenticated;

-- from 005_datasheets.sql
-- Anyone with the tile: called by the reader after every datasheet. Adds the rows this product's mapping has not seen before
-- (shown or not according to the product's setting, marked for review, with the starter keywords); rows already there
-- are not touched. p_rows: [{ key, section, sub, component }, ...] in datasheet order. Only names, never values.
create or replace function public.projects_dn_add_rows(p_product_id text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_prod projects.products; v_show boolean; v_base integer; v_added integer := 0;
begin
  v_user := core.require_tile('projects', null);
  v_prod := projects.product(p_product_id);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'INVALID:rows'; end if;
  if jsonb_array_length(p_rows) > 3000 then raise exception 'INVALID:rows'; end if;
  v_show := coalesce((select s.show_unmapped from projects.dn_map_settings s where s.product_id = v_prod.id), true);
  select coalesce(max(m.sort_order), 0) into v_base from projects.dn_map m where m.product_id = v_prod.id;
  with raw as (
    select trim(r.value ->> 'key') as key, left(trim(coalesce(r.value ->> 'section', '')), 200) as section,
           left(trim(coalesce(r.value ->> 'sub', '')), 200) as sub, left(trim(coalesce(r.value ->> 'component', '')), 200) as component,
           r.ordinality as ord
    from jsonb_array_elements(p_rows) with ordinality r
  ), fresh as (
    select distinct on (key) * from raw
    where char_length(coalesce(key, '')) between 1 and 300
      and not exists (select 1 from projects.dn_map m where m.product_id = v_prod.id and m.row_key = raw.key)
    order by key, ord
  ), ins as (
    insert into projects.dn_map (product_id, row_key, section, sub, component, show, keywords, strip, sort_order, reviewed, updated_by)
    select v_prod.id, f.key, f.section, f.sub, f.component, v_show, coalesce(s.keywords, ''), coalesce(s.strip, ''), v_base + f.ord, false, v_user.id
    from fresh f left join projects.dn_starter_keywords s on s.product_id = v_prod.id and s.row_key = f.key
    on conflict do nothing
    returning 1
  )
  select count(*) into v_added from ins;
  return jsonb_build_object('added', v_added);
end $$;
revoke execute on function public.projects_dn_add_rows(text, jsonb) from public, anon;
grant execute on function public.projects_dn_add_rows(text, jsonb) to authenticated;

-- from 005_datasheets.sql
-- Anyone with the tile: called by the reader after every datasheet. p_items: [{ factory, key, value, model, grp }, ...], one per
-- unit and row; factory is the NAME read from the datasheet. Items whose factory is not one of the product's, whose row
-- the mapping does not show or leaves out of the tree, or that describe the project, are ignored. A set of sizes
-- counts as its pieces. At most 300 different values per row, factory and model; a value seen again counts once more.
-- A value new to the factory waits for a reviewer's approval; a value already approved for the row keeps its approval
-- when it comes back in another group.
create or replace function public.projects_po_collect(p_product_id text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_prod projects.products; g record; v_count integer; v_saved integer := 0; v_ok uuid; v_inherit boolean;
begin
  perform core.require_tile('projects', null);
  v_prod := projects.product(p_product_id);
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'INVALID:items'; end if;
  if jsonb_array_length(p_items) > 20000 then raise exception 'INVALID:items'; end if;
  for g in
    with item as (
      select f.id as factory_id, trim(i.value ->> 'key') as row_key,
             projects.po_model(i.value ->> 'model') as model, projects.po_group(i.value ->> 'grp') as grp,
             projects.po_value(trim(i.value ->> 'key'), i.value ->> 'value') as value
      from jsonb_array_elements(p_items) i
      join projects.factories f on f.product_id = v_prod.id and f.active and lower(f.name) = lower(trim(coalesce(i.value ->> 'factory', '')))
      join projects.dn_map m on m.product_id = v_prod.id and m.row_key = trim(i.value ->> 'key') and m.show and m.in_tree
      where not projects.po_skip(trim(i.value ->> 'key'))
    ), piece as (
      select it.factory_id, it.row_key, it.model, it.grp, lower(p.piece) as value_key, p.piece as value
      from item it cross join lateral unnest(projects.po_pieces(it.value)) as p(piece)
      where p.piece <> '' and p.piece <> '-'
    )
    select factory_id, row_key, model, grp, value_key, min(value) as value, count(*)::integer as n
    from piece group by factory_id, row_key, model, grp, value_key
  loop
    update projects.po_values v set times = v.times + g.n, last_at = now()
     where v.factory_id = g.factory_id and v.row_key = g.row_key and v.model = g.model and v.grp = g.grp and v.value_key = g.value_key;
    if found then v_saved := v_saved + 1; continue; end if;
    select count(*) into v_count from projects.po_values v
     where v.factory_id = g.factory_id and v.row_key = g.row_key and v.model = g.model;
    if v_count >= 300 then continue; end if;
    select v.approved_by into v_ok from projects.po_values v
     where v.factory_id = g.factory_id and v.row_key = g.row_key and v.model = g.model and v.value_key = g.value_key and v.approved
     limit 1;
    v_inherit := found;
    insert into projects.po_values (factory_id, row_key, model, grp, value_key, value, times, approved, approved_by, approved_at)
    values (g.factory_id, g.row_key, g.model, g.grp, g.value_key, g.value, g.n, v_inherit, case when v_inherit then v_ok end, case when v_inherit then now() end);
    v_saved := v_saved + 1;
  end loop;
  return jsonb_build_object('saved', v_saved);
end $$;
revoke execute on function public.projects_po_collect(text, jsonb) from public, anon;
grant execute on function public.projects_po_collect(text, jsonb) to authenticated;

-- from 005_datasheets.sql
-- Anyone with the tile, a project the caller may open: save the table read from a datasheet. p_factory: the factory name the
-- datasheet carries (matched among the product's factories; '' when none or several). A table that covers every unit of
-- an earlier table of the same product in this project replaces it: reading the same datasheet again does not give its
-- units twice. Returns { id, replaced, factory_id }.
create or replace function public.projects_note_save(p_project_id uuid, p_product_id text, p_file_names text, p_columns jsonb, p_rows jsonb, p_factory text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_p projects.projects; v_prod projects.products; v_fac text := ''; v_id uuid;
        v_units integer; v_rows integer; v_bytes integer; v_files text; v_replaced integer;
begin
  v_user := core.require_tile('projects', null);
  select * into v_p from projects.projects p where p.id = p_project_id;
  if not found or not projects.can_open(v_user, v_p) then raise exception 'NOT_FOUND'; end if;
  v_prod := projects.product(p_product_id);
  if p_columns is null or jsonb_typeof(p_columns) <> 'array' or jsonb_array_length(p_columns) = 0 then raise exception 'INVALID:columns'; end if;
  if exists (select 1 from jsonb_array_elements(p_columns) c where jsonb_typeof(c.value) <> 'string') then raise exception 'INVALID:columns'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'INVALID:rows'; end if;
  v_bytes := octet_length(p_rows::text);
  if v_bytes > 12000000 then raise exception 'INVALID:rows'; end if;
  v_files := left(trim(coalesce(p_file_names, '')), 400);
  v_units := jsonb_array_length(p_columns);
  select count(*)::integer into v_rows from jsonb_array_elements(p_rows) r where coalesce(r.value ->> 'kind', 'row') = 'row';
  if trim(coalesce(p_factory, '')) <> '' then
    select f.id into v_fac from projects.factories f where f.product_id = v_prod.id and lower(f.name) = lower(trim(p_factory));
    v_fac := coalesce(v_fac, '');
  end if;
  -- earlier tables of the same product whose every unit is in this one
  with gone as (
    delete from projects.notes n
     where n.project_id = v_p.id and n.product_id = v_prod.id and jsonb_array_length(n.columns) > 0
       and not exists (select 1 from jsonb_array_elements_text(n.columns) c where not (p_columns ? c))
    returning 1)
  select count(*) into v_replaced from gone;
  insert into projects.notes (project_id, user_id, username, product_id, factory_id, file_names, units, row_count, columns, rows, bytes)
  values (v_p.id, v_user.id, v_user.username, v_prod.id, v_fac, v_files, v_units, v_rows, p_columns, p_rows, v_bytes)
  returning id into v_id;
  insert into projects.events (project_id, user_id, username, action, detail)
  values (v_p.id, v_user.id, v_user.username, case when v_replaced > 0 then 'datasheet notes replaced' else 'datasheet notes saved' end,
          left(v_units || case when v_units = 1 then ' unit, ' else ' units, ' end || v_files, 400));
  update projects.projects set updated_by = v_user.id, updated_by_name = v_user.username, updated_at = now() where id = v_p.id;
  perform core.audit('projects', 'note_save', jsonb_build_object('project', v_p.id, 'note', v_id, 'units', v_units, 'replaced', v_replaced));
  return jsonb_build_object('id', v_id, 'replaced', v_replaced, 'factory_id', v_fac);
end $$;
revoke execute on function public.projects_note_save(uuid, text, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.projects_note_save(uuid, text, text, jsonb, jsonb, text) to authenticated;

-- from 005_datasheets.sql
-- Anyone with the tile, a project the caller may open: delete one saved table (read the datasheet again to get it back).
create or replace function public.projects_note_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_n projects.notes; v_p projects.projects;
begin
  v_user := core.require_tile('projects', null);
  select * into v_n from projects.notes n where n.id = p_id;
  if found then select * into v_p from projects.projects p where p.id = v_n.project_id; end if;
  if v_n.id is null or v_p.id is null or not projects.can_open(v_user, v_p) then raise exception 'NOT_FOUND'; end if;
  delete from projects.notes n where n.id = v_n.id;
  insert into projects.events (project_id, user_id, username, action, detail)
  values (v_p.id, v_user.id, v_user.username, 'datasheet notes deleted', left(v_n.file_names, 400));
  update projects.projects set updated_by = v_user.id, updated_by_name = v_user.username, updated_at = now() where id = v_p.id;
  perform core.audit('projects', 'note_delete', jsonb_build_object('project', v_p.id, 'note', v_n.id));
end $$;
revoke execute on function public.projects_note_delete(uuid) from public, anon;
grant execute on function public.projects_note_delete(uuid) to authenticated;

-- from 006_specifications.sql
-- Anyone with the tile, a project the caller may open. p_lines: [{ type, sr, spec }, ...] in document order, at most 8000.
-- Every row is stored; body rows enter the library once each (first seen wins for Part / section / place).
-- Returns { run_id, lines, unique_lines, matched, answers: [{ i, answered, compliance, remarks, comments }] }.
create or replace function public.projects_run_save(p_project_id uuid, p_factory_id text, p_source text, p_file_name text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_p projects.projects; v_f projects.factories; v_run projects.runs; v_reviewer boolean;
        r record; v_norm text; v_hash text; v_line projects.lines; v_matched integer := 0; v_uniq integer := 0;
        v_answers jsonb := '[]'::jsonb; v_source text; v_file text; v_n integer;
begin
  v_user := core.require_tile('projects', null);
  select * into v_p from projects.projects p where p.id = p_project_id;
  if not found or not projects.can_open(v_user, v_p) then raise exception 'NOT_FOUND'; end if;
  select * into v_f from projects.factories f join projects.products pd on pd.id = f.product_id and pd.active where f.id = p_factory_id and f.active;
  if not found then raise exception 'INVALID:factory_id'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'INVALID:lines'; end if;
  if jsonb_array_length(p_lines) > 8000 then raise exception 'INVALID:lines'; end if;
  v_source := case when p_source in ('pdf', 'text') then p_source else '' end;
  v_file := left(coalesce(p_file_name, ''), 200);
  v_reviewer := core.has_tile(v_user.id, 'projects', 'review');

  insert into projects.runs (kind, user_id, username, product_id, factory_id, source, file_name, project_id)
  values ('conversion', v_user.id, v_user.username, v_f.product_id, v_f.id, v_source, v_file, v_p.id)
  returning * into v_run;
  -- every row, in order (seq from 0)
  insert into projects.run_lines (run_id, seq, type, sr, spec_text)
  select v_run.id, x.ordinality - 1, left(coalesce(x.value ->> 'type', ''), 12), left(coalesce(x.value ->> 'sr', ''), 40), left(coalesce(x.value ->> 'spec', ''), 6000)
  from jsonb_array_elements(p_lines) with ordinality x;
  -- the unique clauses, first sighting wins; each finds or makes its library line
  for r in
    select distinct on (projects.library_key(rl.type, rl.spec_text)) rl.seq, rl.type, rl.sr, rl.spec_text,
           projects.library_key(rl.type, rl.spec_text) as norm, coalesce(pl.part, 0) as part, coalesce(pl.section, '') as section, coalesce(pl.section_sr, '') as section_sr
    from projects.run_lines rl left join projects.place_rows(v_run.id) pl on pl.seq = rl.seq
    where rl.run_id = v_run.id and projects.library_key(rl.type, rl.spec_text) is not null
    order by projects.library_key(rl.type, rl.spec_text), rl.seq
  loop
    v_uniq := v_uniq + 1;
    v_hash := md5(r.norm);
    select * into v_line from projects.lines l where l.factory_id = v_f.id and l.norm_hash = v_hash;
    if found then
      update projects.lines set times_seen = times_seen + 1, last_seen_at = now(),
             part = case when part = 0 then r.part else part end, section = case when section = '' then r.section else section end,
             home_seq = case when home_run is null then r.seq else home_seq end, sr = case when home_run is null then regexp_replace(r.sr, '[.)]\s*$', '') else sr end,
             row_type = case when home_run is null then r.type else row_type end, section_sr = case when home_run is null then r.section_sr else section_sr end,
             home_run = coalesce(home_run, v_run.id)
       where id = v_line.id;
    else
      insert into projects.lines (product_id, factory_id, norm_hash, norm_text, spec_text, first_run_id, times_seen, part, section, home_run, home_seq, sr, row_type, section_sr)
      values (v_f.product_id, v_f.id, v_hash, r.norm, r.spec_text, v_run.id, 1, r.part, r.section, v_run.id, r.seq, regexp_replace(r.sr, '[.)]\s*$', ''), r.type, r.section_sr)
      returning * into v_line;
    end if;
    -- every row of the run with this clause points at the line
    update projects.run_lines set line_id = v_line.id where run_id = v_run.id and projects.library_key(type, spec_text) = r.norm;
  end loop;
  -- counts and the answers the library already holds, per row
  for r in
    select rl.seq, l.status, l.compliance, l.remarks, l.comments from projects.run_lines rl join projects.lines l on l.id = rl.line_id
    where rl.run_id = v_run.id order by rl.seq
  loop
    if r.status = 'answered' then v_matched := v_matched + 1; end if;
    if r.status = 'answered' or projects.comments_for(r.comments, v_reviewer) <> '' then
      v_answers := v_answers || jsonb_build_object('i', r.seq, 'answered', r.status = 'answered',
        'compliance', case when r.status = 'answered' then r.compliance else '' end, 'remarks', case when r.status = 'answered' then r.remarks else '' end,
        'comments', projects.comments_for(r.comments, v_reviewer));
    end if;
  end loop;
  select count(*) into v_n from projects.run_lines rl where rl.run_id = v_run.id;
  update projects.runs set line_count = v_n, unique_count = v_uniq, matched_count = v_matched where id = v_run.id;
  insert into projects.events (project_id, user_id, username, action, detail) values (v_p.id, v_user.id, v_user.username, 'specification converted', left(v_file, 400));
  update projects.projects set updated_by = v_user.id, updated_by_name = v_user.username, updated_at = now() where id = v_p.id;
  perform core.audit('projects', 'run_save', jsonb_build_object('project', v_p.id, 'run', v_run.id, 'factory', v_f.id, 'lines', v_n));
  return jsonb_build_object('run_id', v_run.id, 'lines', v_n, 'unique_lines', v_uniq, 'matched', v_matched, 'answers', v_answers);
end $$;
revoke execute on function public.projects_run_save(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.projects_run_save(uuid, text, text, text, jsonb) to authenticated;

-- from 006_specifications.sql
-- Anyone who may open the project: every row of the record in order, the project's own answer and the library's.
-- can_comment = right 'review' (Internal Comments); can_review = tile admin or super user (TL Review).
-- The precedent: the earlier record of the same factory that shares the most identical clauses (5 or more).
create or replace function public.projects_run_get(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_r projects.runs; v_p projects.projects; v_reviewer boolean; v_admin boolean; v_prec jsonb := null; pr record; v_pp projects.projects;
begin
  v_user := core.require_tile('projects', null);
  v_r := projects.run_in_project(v_user, p_run_id);
  select * into v_p from projects.projects p where p.id = v_r.project_id;
  v_reviewer := core.has_tile(v_user.id, 'projects', 'review');
  v_admin := core.is_tile_admin(v_user.id, 'projects');
  select b.run_id, r2.file_name, r2.created_at, r2.project_id, count(distinct a.seq) as same,
         count(distinct case when b.compliance <> '' or b.remarks <> '' then a.seq end) as answered
    into pr
    from projects.run_lines a join projects.run_lines b on b.line_id = a.line_id and b.run_id <> a.run_id
    join projects.runs r2 on r2.id = b.run_id
   where a.run_id = v_r.id and a.line_id is not null and r2.factory_id = v_r.factory_id
   group by b.run_id, r2.file_name, r2.created_at, r2.project_id order by same desc, r2.created_at desc limit 1;
  if pr.run_id is not null and pr.same >= 5 then
    v_pp := null;
    if pr.project_id is not null then select * into v_pp from projects.projects p where p.id = pr.project_id; end if;
    -- another person's project is named only to those who may open it
    v_prec := jsonb_build_object('same', pr.same, 'answered', pr.answered, 'at', pr.created_at,
      'clauses', (select count(*) from projects.run_lines x where x.run_id = v_r.id and x.line_id is not null),
      'project', case when v_pp.id is not null and projects.can_open(v_user, v_pp) then v_pp.name else '' end,
      'file_name', case when v_pp.id is not null and projects.can_open(v_user, v_pp) then pr.file_name else '' end,
      'run_id', case when v_pp.id is not null and projects.can_open(v_user, v_pp) then pr.run_id::text else '' end);
  end if;
  return jsonb_build_object(
    'run', jsonb_build_object('id', v_r.id, 'file_name', v_r.file_name, 'created_at', v_r.created_at, 'user', v_r.username,
      'product', (select pd.name from projects.products pd where pd.id = v_r.product_id), 'product_id', v_r.product_id,
      'factory', (select f.name from projects.factories f where f.id = v_r.factory_id), 'factory_id', v_r.factory_id,
      'project_id', v_p.id, 'project', v_p.name, 'project_code', v_p.code, 'client', v_p.client_name, 'region', v_p.region,
      'can_comment', v_reviewer, 'can_review', v_admin, 'can_edit', true, 'precedent', v_prec),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
        'seq', rl.seq, 'type', rl.type, 'sr', rl.sr, 'spec', rl.spec_text, 'can', rl.line_id is not null,
        'own', rl.compliance <> '' or rl.remarks <> '', 'compliance', rl.compliance, 'remarks', rl.remarks, 'review', rl.review,
        'by', coalesce(d.username, ''), 'lib_compliance', case when l.status = 'answered' then l.compliance else '' end,
        'lib_remarks', case when l.status = 'answered' then l.remarks else '' end,
        'lib_comments', projects.comments_for(l.comments, v_reviewer), 'tl_review', rl.tl_review) order by rl.seq), '[]'::jsonb)
      from projects.run_lines rl left join projects.lines l on l.id = rl.line_id
      left join core.display_names('projects', (select array_agg(distinct x.answered_by) from projects.run_lines x where x.run_id = v_r.id and x.answered_by is not null)) d on d.id = rl.answered_by
      where rl.run_id = v_r.id));
end $$;
revoke execute on function public.projects_run_get(uuid) from public, anon;
grant execute on function public.projects_run_get(uuid) to authenticated;

-- from 006_specifications.sql
-- Anyone with the tile: the answer typed for one row. Equal to the library's = no review; anything else waits for review.
create or replace function public.projects_run_save_line(p_run_id uuid, p_seq integer, p_compliance text, p_remarks text, p_check text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_r projects.runs; v_rl projects.run_lines; v_review text;
begin
  v_user := core.require_tile('projects', null);
  v_r := projects.run_in_project(v_user, p_run_id);
  select * into v_rl from projects.run_lines rl where rl.run_id = v_r.id and rl.seq = p_seq;
  if not found or v_rl.line_id is null then raise exception 'INVALID:seq'; end if;
  perform projects.check_row(v_rl.spec_text, p_check);
  v_review := projects.answer_line(v_user, v_r.id, v_rl.seq, left(trim(coalesce(p_compliance, '')), 200), left(trim(coalesce(p_remarks, '')), 4000));
  perform projects.log_hourly(v_user, v_r.project_id, 'compliance filled online', coalesce(nullif(v_r.file_name, ''), 'pasted text'));
  return jsonb_build_object('review', v_review);
end $$;
revoke execute on function public.projects_run_save_line(uuid, integer, text, text, text) from public, anon;
grant execute on function public.projects_run_save_line(uuid, integer, text, text, text) to authenticated;

-- from 006_specifications.sql
-- Anyone with the tile: one answer for every clause of a section (the rows after the heading p_seq down to the next section or
-- PART row). p_replace false = only the clauses that show no answer yet. p_compliance '' takes the project's own answers off.
create or replace function public.projects_run_fill_section(p_run_id uuid, p_seq integer, p_compliance text, p_replace boolean default false, p_check text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_r projects.runs; v_h projects.run_lines; v_end integer; r record; v_c text; v_n integer := 0; v_kept integer := 0; v_own boolean; v_lib boolean;
begin
  v_user := core.require_tile('projects', null);
  v_r := projects.run_in_project(v_user, p_run_id);
  select * into v_h from projects.run_lines rl where rl.run_id = v_r.id and rl.seq = p_seq;
  if not found or v_h.type <> 'section' then raise exception 'INVALID:seq'; end if;
  perform projects.check_row(v_h.spec_text, p_check);
  v_c := left(trim(coalesce(p_compliance, '')), 200);
  select coalesce(min(rl.seq), 2147483647) into v_end from projects.run_lines rl where rl.run_id = v_r.id and rl.seq > v_h.seq and rl.type in ('section', 'part');
  for r in
    select rl.seq, rl.compliance, rl.remarks, l.status as l_status, l.remarks as l_remarks
    from projects.run_lines rl left join projects.lines l on l.id = rl.line_id
    where rl.run_id = v_r.id and rl.seq > v_h.seq and rl.seq < v_end and rl.line_id is not null order by rl.seq
  loop
    v_own := r.compliance <> '' or r.remarks <> ''; v_lib := r.l_status = 'answered';
    if v_c = '' then
      if v_own then perform projects.answer_line(v_user, v_r.id, r.seq, '', ''); v_n := v_n + 1; end if;
      continue;
    end if;
    if (v_own or v_lib) and not coalesce(p_replace, false) then v_kept := v_kept + 1; continue; end if;
    perform projects.answer_line(v_user, v_r.id, r.seq, v_c, case when v_own then r.remarks when v_lib then coalesce(r.l_remarks, '') else '' end);
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then perform projects.log_hourly(v_user, v_r.project_id, 'compliance filled online', coalesce(nullif(v_r.file_name, ''), 'pasted text')); end if;
  return jsonb_build_object('filled', v_n, 'kept', v_kept);
end $$;
revoke execute on function public.projects_run_fill_section(uuid, integer, text, boolean, text) from public, anon;
grant execute on function public.projects_run_fill_section(uuid, integer, text, boolean, text) to authenticated;

-- from 006_specifications.sql
-- Anyone with the tile: split one row into several. p_rows: [{ type, sr, spec }, ...], at least two, at most 60. The first keeps
-- the label, type and answer of the row; the words never change (INVALID:rows otherwise).
create or replace function public.projects_run_split(p_run_id uuid, p_seq integer, p_rows jsonb, p_check text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_r projects.runs; v_rl projects.run_lines; v_n integer; v_total integer; x record; v_first uuid; v_line uuid; v_type text; v_bare_in text := ''; v_k integer := 0;
begin
  v_user := core.require_tile('projects', null);
  v_r := projects.run_in_project(v_user, p_run_id);
  select * into v_rl from projects.run_lines rl where rl.run_id = v_r.id and rl.seq = p_seq;
  if not found then raise exception 'INVALID:seq'; end if;
  perform projects.check_row(v_rl.spec_text, p_check);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'INVALID:rows'; end if;
  v_n := jsonb_array_length(p_rows);
  if v_n < 2 or v_n > 60 then raise exception 'INVALID:rows'; end if;
  select count(*) into v_total from projects.run_lines rl where rl.run_id = v_r.id;
  if v_total + v_n > 8000 then raise exception 'INVALID:rows'; end if;
  -- the same words, in the same order (the label of the first row is not part of the text)
  for x in select (ordinality - 1) as k, left(trim(coalesce(value ->> 'sr', '')), 40) as sr, left(trim(regexp_replace(coalesce(value ->> 'spec', ''), '\s+', ' ', 'g')), 6000) as spec from jsonb_array_elements(p_rows) with ordinality loop
    if x.spec = '' and x.sr = '' then raise exception 'INVALID:rows'; end if;
    v_bare_in := v_bare_in || regexp_replace(lower(case when x.k = 0 then '' else x.sr end || x.spec), '[^a-z0-9]+', '', 'g');
  end loop;
  if v_bare_in <> regexp_replace(lower(v_rl.spec_text), '[^a-z0-9]+', '', 'g') then raise exception 'INVALID:rows'; end if;
  perform projects.shift_rows(v_r.id, v_rl.seq, v_n - 1);
  for x in select (ordinality - 1) as k, coalesce(value ->> 'type', 'text') as type, left(trim(coalesce(value ->> 'sr', '')), 40) as sr, left(trim(regexp_replace(coalesce(value ->> 'spec', ''), '\s+', ' ', 'g')), 6000) as spec from jsonb_array_elements(p_rows) with ordinality order by ordinality loop
    if x.k = 0 then
      v_first := case when v_rl.type in ('letter', 'number', 'text') then projects.run_line(v_r, v_rl.type, x.spec) end;
      update projects.run_lines set spec_text = x.spec, line_id = v_first where run_id = v_r.id and seq = v_rl.seq;
    else
      v_type := case when x.type in ('part', 'section', 'letter', 'number', 'text') then x.type else 'text' end;
      v_line := case when v_type in ('letter', 'number', 'text') then projects.run_line(v_r, v_type, x.spec) end;
      insert into projects.run_lines (run_id, seq, type, sr, spec_text, line_id) values (v_r.id, v_rl.seq + x.k, v_type, x.sr, x.spec, v_line);
    end if;
  end loop;
  if v_first is null then
    update projects.run_lines set compliance = '', remarks = '', answered_by = null, answered_at = null, review = '', reviewed_by = null, reviewed_at = null where run_id = v_r.id and seq = v_rl.seq;
  else
    update projects.run_lines set review = 'pending', reviewed_by = null, reviewed_at = null where run_id = v_r.id and seq = v_rl.seq and (compliance <> '' or remarks <> '');
  end if;
  if v_rl.line_id is not null and v_rl.line_id is distinct from v_first then perform projects.drop_unused_line(v_rl.line_id); end if;
  perform projects.run_reshaped(v_user, v_r);
  return jsonb_build_object('rows', v_n);
end $$;
revoke execute on function public.projects_run_split(uuid, integer, jsonb, text) from public, anon;
grant execute on function public.projects_run_split(uuid, integer, jsonb, text) to authenticated;

-- from 006_specifications.sql
-- Anyone with the tile: join a row to the row above it. The row above keeps its label and type; its own answer wins, else the
-- answer of the joined row is kept. PART rows are never joined; a heading cannot take an answer (INVALID:join).
create or replace function public.projects_run_join(p_run_id uuid, p_seq integer, p_check text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_r projects.runs; a projects.run_lines; b projects.run_lines; v_spec text; v_line uuid; v_keep_b boolean; v_tl text; v_src projects.run_lines; v_c text; v_m text; v_review text;
begin
  v_user := core.require_tile('projects', null);
  v_r := projects.run_in_project(v_user, p_run_id);
  select * into b from projects.run_lines rl where rl.run_id = v_r.id and rl.seq = p_seq;
  select * into a from projects.run_lines rl where rl.run_id = v_r.id and rl.seq = p_seq - 1;
  if a.run_id is null or b.run_id is null then raise exception 'INVALID:seq'; end if;
  if a.type = 'part' or b.type = 'part' then raise exception 'INVALID:join'; end if;
  perform projects.check_row(b.spec_text, p_check);
  if a.type = 'section' and (b.compliance <> '' or b.remarks <> '' or b.tl_review <> '') then raise exception 'INVALID:join'; end if;
  v_spec := trim(a.spec_text || ' ' || case when b.sr <> '' and b.sr <> '•' then b.sr || ' ' else '' end || b.spec_text);
  if char_length(v_spec) > 6000 then raise exception 'INVALID:join'; end if;
  v_line := case when a.type in ('letter', 'number', 'text') then projects.run_line(v_r, a.type, v_spec) end;
  v_keep_b := v_line is not null and a.compliance = '' and a.remarks = '' and (b.compliance <> '' or b.remarks <> '');
  v_tl := left(concat_ws(' / ', nullif(a.tl_review, ''), nullif(b.tl_review, '')), 4000);
  if v_line is null then v_src := null; elsif v_keep_b then v_src := b; else v_src := a; end if;
  v_c := coalesce(v_src.compliance, ''); v_m := coalesce(v_src.remarks, '');
  v_review := case when v_src.run_id is not null and (v_c <> '' or v_m <> '') then 'pending' else '' end;
  update projects.run_lines set spec_text = v_spec, line_id = v_line, tl_review = coalesce(v_tl, ''), compliance = v_c, remarks = v_m,
         answered_by = v_src.answered_by, answered_at = v_src.answered_at, review = v_review, reviewed_by = null, reviewed_at = null
   where run_id = v_r.id and seq = a.seq;
  delete from projects.run_lines where run_id = v_r.id and seq = b.seq;
  perform projects.shift_rows(v_r.id, b.seq, -1);
  if a.line_id is not null and a.line_id is distinct from v_line then perform projects.drop_unused_line(a.line_id); end if;
  if b.line_id is not null and b.line_id is distinct from v_line then perform projects.drop_unused_line(b.line_id); end if;
  perform projects.run_reshaped(v_user, v_r);
end $$;
revoke execute on function public.projects_run_join(uuid, integer, text) from public, anon;
grant execute on function public.projects_run_join(uuid, integer, text) to authenticated;

-- from 006_specifications.sql
-- Anyone with the tile: the record leaves the project (it stays in the library's conversion history); answers waiting for
-- review are withdrawn; clauses and approved answers already in the library stay there.
create or replace function public.projects_run_delete(p_run_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_r projects.runs;
begin
  v_user := core.require_tile('projects', null);
  v_r := projects.run_in_project(v_user, p_run_id);
  update projects.run_lines set review = '' where run_id = v_r.id and review = 'pending';
  update projects.runs set project_id = null where id = v_r.id;
  insert into projects.events (project_id, user_id, username, action, detail) values (v_r.project_id, v_user.id, v_user.username, 'compliance record removed', left(v_r.file_name, 400));
  update projects.projects set updated_by = v_user.id, updated_by_name = v_user.username, updated_at = now() where id = v_r.project_id;
  perform core.audit('projects', 'run_delete', jsonb_build_object('project', v_r.project_id, 'run', v_r.id));
end $$;
revoke execute on function public.projects_run_delete(uuid) from public, anon;
grant execute on function public.projects_run_delete(uuid) to authenticated;

-- from 006_specifications.sql
-- Anyone with the tile: the answers read from a filled Excel, p_rows: [{ spec, compliance, remarks }, ...] (at most 20000).
-- Each answer lands on the matching row (same text rule as the library; the last of a repeated clause wins).
create or replace function public.projects_run_submit_answers(p_run_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_r projects.runs; r record; v_stored integer := 0; v_pending integer := 0;
begin
  v_user := core.require_tile('projects', null);
  v_r := projects.run_in_project(v_user, p_run_id);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'INVALID:rows'; end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'INVALID:rows'; end if;
  for r in
    with src as (
      select distinct on (projects.cm_norm(x.value ->> 'spec')) projects.cm_norm(x.value ->> 'spec') as norm,
             left(trim(coalesce(x.value ->> 'compliance', '')), 200) as c, left(trim(coalesce(x.value ->> 'remarks', '')), 4000) as m
      from jsonb_array_elements(p_rows) with ordinality x
      where left(trim(coalesce(x.value ->> 'compliance', '')), 200) <> '' or left(trim(coalesce(x.value ->> 'remarks', '')), 4000) <> ''
      order by projects.cm_norm(x.value ->> 'spec'), x.ordinality desc
    )
    select rl.seq, s.c, s.m from projects.run_lines rl join src s on s.norm = projects.cm_norm(rl.spec_text)
    where rl.run_id = v_r.id and rl.line_id is not null and not (rl.compliance = s.c and rl.remarks = s.m) order by rl.seq
  loop
    v_stored := v_stored + 1;
    if projects.answer_line(v_user, v_r.id, r.seq, r.c, r.m) = 'pending' then v_pending := v_pending + 1; end if;
  end loop;
  insert into projects.events (project_id, user_id, username, action, detail)
  values (v_r.project_id, v_user.id, v_user.username, 'filled compliance uploaded', left(v_stored || ' answers saved, ' || v_pending || ' sent for review (' || coalesce(nullif(v_r.file_name, ''), 'pasted text') || ')', 400));
  update projects.projects set updated_by = v_user.id, updated_by_name = v_user.username, updated_at = now() where id = v_r.project_id;
  return jsonb_build_object('rows', jsonb_array_length(p_rows), 'stored', v_stored, 'pending', v_pending);
end $$;
revoke execute on function public.projects_run_submit_answers(uuid, jsonb) from public, anon;
grant execute on function public.projects_run_submit_answers(uuid, jsonb) to authenticated;

select core.applied('projects', '009_open_edit');
