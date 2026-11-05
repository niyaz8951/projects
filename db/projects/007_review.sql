-- Projects tile, step 4 (Compliance review): the factory compliance library for the reviewers (right 'review': tile
-- admins and the super user hold it; the tile admin gives it to nobody else unless he decides). Rewritten from the old
-- tool's cm_admin_lines / cm_admin_save_answer / cm_admin_delete_line / cm_admin_import / cm_admin_runs /
-- cm_admin_export / cm_reset_library (worker/src/api/cm.ts), pr_review_decide (pr.ts) and lib/cm.ts (cmTopic,
-- cmLibraryOrder, choiceOf), with the same checks. Nothing goes live unapproved: a user's answer reaches the library
-- only through 'Use this answer'; an editor's own answer and an uploaded library are the library's at once.
-- Touches only: schema projects and functions public.projects_*. Run after 006_specifications.sql.

-- ---------------------------------------------------------------------------
-- 1. Pure helpers
-- ---------------------------------------------------------------------------

-- Section title -> topic (cmTopic). First match wins.
create or replace function projects.topic(p_section text)
returns text language plpgsql immutable as $$
declare s text := lower(coalesce(p_section, ''));
begin
  if s = '' then return ''; end if;
  if s ~ '\m(field quality|install|examin|prepar|adjust|clean|demonstrat|commission|start.?up|testing|connection|training)' then return 'Installation and testing'; end if;
  if s ~ '\m(submittal|shop drawing|closeout)' then return 'Submittals'; end if;
  if s ~ '\m(quality|warrant|regulat|certif|standard|reference|performance|health|safety|code)' then return 'Standards and quality'; end if;
  if s ~ '\m(filter)' then return 'Filters'; end if;
  if s ~ '\m(humidif|dehumidif)' then return 'Humidifier'; end if;
  if s ~ '\m(heat recovery|recovery wheel|heat wheel|heat pipe|recuperator|run.?around)' then return 'Heat recovery'; end if;
  if s ~ '\m(coil|heat exchanger|eliminator|drain pan)' then return 'Coils'; end if;
  if s ~ '\m(damper|mixing|plenum|louv|economi)' then return 'Dampers and mixing'; end if;
  if s ~ '\m(sound|noise|acoustic|attenuat|silencer|vibration)' then return 'Sound and vibration'; end if;
  if s ~ '\m(fan|blower|motor|drive|bearing|belt)' then return 'Fans and drives'; end if;
  if s ~ '\m(control|electric|wiring|starter|variable frequency|vfd|instrument|sensor)' then return 'Controls and electrical'; end if;
  if s ~ '\m(casing|cabinet|enclosure|panel|housing|construction|gasket|door|insulat|base|frame|support|roof)' then return 'Casing and base'; end if;
  if s ~ '\m(deliver|storage|extra material|spare|maintenance)' then return 'Delivery and spares'; end if;
  if s ~ '\m(general|summary|description|scope|includes|related|definition|coordination|manufacturer|material)' then return 'General'; end if;
  return 'Other';
end $$;

-- The six answers in their standard words (choiceOf): "By contractor" -> "In Contractor's Scope", "Comply as noted" ->
-- Comply with Remarks when a remark is there, else Comply; "-" = no answer. Anything else stays as written.
create or replace function projects.choice_of(p_value text, p_remarks text)
returns text language plpgsql immutable as $$
declare raw text := trim(coalesce(p_value, '')); n text := projects.cm_norm(p_value);
begin
  if n = '' and raw ~ '^[-–—.\s]*$' then return ''; end if;
  if n = 'comply as noted' then
    return case when trim(coalesce(p_remarks, '')) <> '' and projects.cm_norm(p_remarks) <> 'noted' then 'Comply with Remarks' else 'Comply' end;
  end if;
  return case
    when n in ('comply', 'complied', 'compliant', 'complies', 'yes', 'ok') then 'Comply'
    when n in ('comply with remarks', 'comply with remark', 'complied with remarks', 'comply w remarks', 'comply as per remarks', 'as remark', 'as remarks', 'partially comply', 'partially complied') then 'Comply with Remarks'
    when n in ('noted', 'as noted', 'note', 'acknowledged') then 'Noted'
    when n in ('not comply', 'not complied', 'non compliant', 'does not comply', 'deviation', 'not compliant') then 'Not Comply'
    when n in ('not applicable', 'n a', 'na') then 'Not Applicable'
    when n in ('in contractor s scope', 'in contractors scope', 'by contractor', 'by others', 'by contractor others', 'contractor scope', 'contractor s scope') then 'In Contractor''s Scope'
    else raw end;
end $$;

-- A factory of an active product, or INVALID:factory_id.
create or replace function projects.factory(p_id text)
returns projects.factories language plpgsql stable security definer set search_path = '' as $$
declare v projects.factories;
begin
  select f.* into v from projects.factories f join projects.products p on p.id = f.product_id and p.active where f.id = p_id and f.active;
  if not found then raise exception 'INVALID:factory_id'; end if;
  return v;
end $$;

-- The library of one factory in reading order (cmLibraryOrder): Part 1, 2, 3 (0 last); sections by title, a title's
-- group by its lowest section number; inside a title one block per conversion (oldest first); then the order in that
-- specification. With a project code: only the lines of that project's specifications, in their order there.
create or replace function projects.library_rows(p_factory_id text, p_code text)
returns table (id uuid, ord bigint, codes text[], file_name text)
language sql stable security definer set search_path = '' as $$
  with seen as (
    select rl.line_id, p.code, min(to_char(r.created_at, 'YYYYMMDDHH24MISSUS') || '|' || lpad(rl.seq::text, 6, '0')) as at
    from projects.run_lines rl join projects.runs r on r.id = rl.run_id join projects.projects p on p.id = r.project_id
    where r.factory_id = p_factory_id and rl.line_id is not null
    group by rl.line_id, p.code
  ), codes as (
    select s.line_id, array_agg(distinct s.code order by s.code) as codes, min(case when s.code = p_code then s.at end) as place from seen s group by s.line_id
  ), lib as (
    select l.*, hr.created_at as run_at, coalesce(hr.file_name, '') as run_file, coalesce(c.codes, '{}') as codes, c.place,
           min(case when l.section_sr ~ '^\d{1,2}\.\d{1,2}$' then split_part(l.section_sr, '.', 1)::int * 1000 + split_part(l.section_sr, '.', 2)::int else 99999 end)
             over (partition by l.part, lower(l.section)) as gsort
    from projects.lines l left join projects.runs hr on hr.id = l.home_run left join codes c on c.line_id = l.id
    where l.factory_id = p_factory_id
  )
  select lib.id,
         row_number() over (order by
           case when coalesce(p_code, '') <> '' then lib.place end,
           (lib.part = 0), lib.part, lib.gsort, lower(lib.section), lib.run_at nulls last, lib.home_run::text nulls last,
           lib.home_seq nulls last, lib.first_seen_at, lib.id::text),
         lib.codes, lib.run_file
  from lib where coalesce(p_code, '') = '' or lib.place is not null;
$$;

-- ---------------------------------------------------------------------------
-- 2. The library page
-- ---------------------------------------------------------------------------

-- Right 'review': one page of a factory's library in reading order, with the filters, the counts, the users' answers
-- per clause (who, project code, client) and the lists for the filters. p_status: open | answered | review | all.
create or replace function public.projects_lib_lines(p_factory_id text, p_status text default 'open', p_search text default '',
  p_part integer default null, p_topic text default '', p_client_type text default '', p_client_name text default '',
  p_project_code text default '', p_limit integer default 100, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_f projects.factories; v_status text; v_q text; v_code text; v_limit integer; v_offset integer; v_res jsonb;
begin
  perform core.require_tile('projects', 'review');
  v_f := projects.factory(p_factory_id);
  v_status := case when p_status in ('open', 'answered', 'review', 'all') then p_status else 'open' end;
  v_q := lower(trim(coalesce(p_search, '')));
  if char_length(v_q) > 200 then raise exception 'INVALID:search'; end if;
  v_code := upper(trim(coalesce(p_project_code, '')));
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 300); v_offset := greatest(coalesce(p_offset, 0), 0);
  with pa as (       -- every project answer and sighting of this factory's lines
    select rl.line_id, rl.run_id, rl.seq, rl.compliance, rl.remarks, rl.review, rl.answered_by, rl.answered_at,
           p.name as project, p.client_name as client, p.client_type, p.region, p.code
    from projects.run_lines rl join projects.runs r on r.id = rl.run_id join projects.projects p on p.id = r.project_id
    where r.factory_id = v_f.id and rl.line_id is not null
  ), waiting as (select distinct pa.line_id from pa where pa.review = 'pending'),
  ordered as (select * from projects.library_rows(v_f.id, v_code)),
  hit as (
    select l.*, o.ord, o.codes, o.file_name as home_file from projects.lines l join ordered o on o.id = l.id
    where (v_status = 'all' or l.status = v_status or (v_status = 'review' and exists (select 1 from waiting w where w.line_id = l.id)))
      and (p_part is null or l.part = p_part)
      and (coalesce(p_topic, '') = '' or projects.topic(l.section) = p_topic)
      and (v_q = '' or lower(l.spec_text) like '%' || v_q || '%')
      and ((coalesce(p_client_type, '') = '' and coalesce(p_client_name, '') = '')
           or exists (select 1 from pa where pa.line_id = l.id and (coalesce(p_client_type, '') = '' or pa.client_type = p_client_type)
                                          and (coalesce(p_client_name, '') = '' or pa.client = p_client_name)))
  ), page as (select * from hit order by hit.ord limit v_limit offset v_offset),
  names as (select * from core.display_names('projects', (select array_agg(distinct x) from (select pa.answered_by as x from pa where pa.answered_by is not null
                                                                                         union select l.answered_by from projects.lines l where l.factory_id = v_f.id and l.answered_by is not null) u)))
  select jsonb_build_object(
    'counts', (select jsonb_build_object('all', count(*), 'open', count(*) filter (where l.status = 'open'), 'answered', count(*) filter (where l.status = 'answered'),
                                         'review', (select count(*) from waiting)) from projects.lines l where l.factory_id = v_f.id),
    'groups', (select coalesce(jsonb_agg(jsonb_build_object('part', g.part, 'topic', g.topic, 'all', g.n, 'open', g.o) order by (g.part = 0), g.part, g.topic), '[]'::jsonb)
               from (select l.part, projects.topic(l.section) as topic, count(*) as n, count(*) filter (where l.status = 'open') as o
                     from projects.lines l where l.factory_id = v_f.id group by 1, 2) g),
    'client_types', (select coalesce(jsonb_agg(distinct pa.client_type), '[]'::jsonb) from pa),
    'client_names', (select coalesce(jsonb_agg(distinct pa.client), '[]'::jsonb) from pa where coalesce(p_client_type, '') = '' or pa.client_type = p_client_type),
    'project_codes', (select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'project', c.project) order by c.code desc), '[]'::jsonb)
                      from (select distinct pa.code, pa.project from pa) c),
    'total', (select count(*) from hit),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'spec_text', x.spec_text, 'compliance', x.compliance, 'remarks', x.remarks, 'comments', x.comments, 'status', x.status,
        'times_seen', x.times_seen, 'last_seen_at', x.last_seen_at, 'answered_at', x.answered_at, 'answer_source', x.answer_source,
        'part', x.part, 'section', x.section, 'topic', projects.topic(x.section), 'sr', x.sr, 'row_type', x.row_type, 'section_sr', x.section_sr,
        'home_run', x.home_run, 'file_name', x.home_file, 'answered_by', (select n.username from names n where n.id = x.answered_by),
        'project_codes', to_jsonb(x.codes),
        'project_answers', (select coalesce(jsonb_agg(jsonb_build_object('run', a.run_id, 'seq', a.seq, 'compliance', a.compliance, 'remarks', a.remarks,
              'review', a.review, 'by', coalesce((select n.username from names n where n.id = a.answered_by), ''), 'at', a.answered_at,
              'project', a.project, 'code', a.code, 'client', a.client, 'client_type', a.client_type, 'region', a.region)
              order by (a.review <> 'pending'), a.answered_at desc nulls last), '[]'::jsonb)
            from (select * from pa where pa.line_id = x.id and (pa.compliance <> '' or pa.remarks <> '')
                  order by (pa.review <> 'pending'), pa.answered_at desc nulls last limit 6) a))
        order by x.ord), '[]'::jsonb) from page x),
    'can_edit', true)
  into v_res;
  return v_res;
end $$;
revoke execute on function public.projects_lib_lines(text, text, text, integer, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.projects_lib_lines(text, text, text, integer, text, text, text, text, integer, integer) to authenticated;

-- Right 'review': fill in (or clear) the answer of one library line; p_comments null leaves Internal Comments as they are.
-- The library's answer is the reviewer's at once (answer_source 'admin') and is logged.
create or replace function public.projects_lib_save_answer(p_line_id uuid, p_compliance text, p_remarks text, p_comments text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_l projects.lines; v_c text; v_r text; v_status text;
begin
  v_user := core.require_tile('projects', 'review');
  select * into v_l from projects.lines l where l.id = p_line_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_c := left(trim(coalesce(p_compliance, '')), 200); v_r := left(trim(coalesce(p_remarks, '')), 4000);
  if p_comments is not null then update projects.lines set comments = left(trim(p_comments), 4000) where id = v_l.id; end if;
  if v_l.compliance = v_c and v_l.remarks = v_r then return jsonb_build_object('status', v_l.status); end if;
  v_status := case when v_c <> '' or v_r <> '' then 'answered' else 'open' end;
  update projects.lines set compliance = v_c, remarks = v_r, status = v_status, answered_by = v_user.id, answered_at = now(), answer_source = 'admin' where id = v_l.id;
  insert into projects.answer_log (line_id, compliance, remarks, source, user_id) values (v_l.id, v_c, v_r, 'admin', v_user.id);
  return jsonb_build_object('status', v_status);
end $$;
revoke execute on function public.projects_lib_save_answer(uuid, text, text, text) from public, anon;
grant execute on function public.projects_lib_save_answer(uuid, text, text, text) to authenticated;

-- Right 'review': a junk line leaves the library (rows of records that held it can no longer be answered).
create or replace function public.projects_lib_delete_line(p_line_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_l projects.lines;
begin
  perform core.require_tile('projects', 'review');
  delete from projects.lines l where l.id = p_line_id returning * into v_l;
  if v_l.id is null then raise exception 'NOT_FOUND'; end if;
  perform core.audit('projects', 'lib_delete_line', jsonb_build_object('line', v_l.id, 'factory', v_l.factory_id));
end $$;
revoke execute on function public.projects_lib_delete_line(uuid) from public, anon;
grant execute on function public.projects_lib_delete_line(uuid) to authenticated;

-- Right 'review': approve or reject a user's answer from a record. Approve: the answer (as given, or as corrected
-- here) becomes the library's for that clause and factory; the same answer waiting on other records of the clause is
-- settled with it; a library line that already has another answer is never overwritten from a project
-- (INVALID:answered). Reject: the answer stays in its project only. p_line_id: the line the reviewer was looking at
-- (another line means the rows moved: INVALID:check).
create or replace function public.projects_review_decide(p_run_id uuid, p_seq integer, p_decision text, p_line_id uuid default null,
  p_compliance text default null, p_remarks text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_rl projects.run_lines; v_r projects.runs; v_l projects.lines; v_c text; v_m text;
begin
  v_user := core.require_tile('projects', 'review');
  select * into v_rl from projects.run_lines rl where rl.run_id = p_run_id and rl.seq = p_seq;
  if not found or v_rl.line_id is null or v_rl.review = '' then raise exception 'NOT_FOUND'; end if;
  if p_line_id is not null and v_rl.line_id <> p_line_id then raise exception 'INVALID:check'; end if;
  select * into v_r from projects.runs r where r.id = v_rl.run_id;
  if p_decision = 'approve' then
    v_c := left(trim(coalesce(p_compliance, v_rl.compliance)), 200); v_m := left(trim(coalesce(p_remarks, v_rl.remarks)), 4000);
    if v_c = '' and v_m = '' then raise exception 'INVALID:answer'; end if;
    select * into v_l from projects.lines l where l.id = v_rl.line_id;
    if v_l.status = 'answered' and (v_l.compliance <> v_c or v_l.remarks <> v_m) then raise exception 'INVALID:answered'; end if;
    update projects.lines set compliance = v_c, remarks = v_m, status = 'answered', answered_by = v_user.id, answered_at = now(), answer_source = 'approved' where id = v_rl.line_id;
    insert into projects.answer_log (line_id, compliance, remarks, source, run_id, user_id) values (v_rl.line_id, v_c, v_m, 'approved', v_rl.run_id, v_user.id);
    update projects.run_lines set review = 'approved', reviewed_by = v_user.id, reviewed_at = now()
     where line_id = v_rl.line_id and review = 'pending' and ((run_id = v_rl.run_id and seq = v_rl.seq) or (compliance = v_c and remarks = v_m));
    if v_r.project_id is not null then
      insert into projects.events (project_id, user_id, username, action, detail) values (v_r.project_id, v_user.id, v_user.username, 'answer approved for the library', left(v_rl.spec_text, 200));
    end if;
  elsif p_decision = 'reject' then
    update projects.run_lines set review = 'rejected', reviewed_by = v_user.id, reviewed_at = now() where run_id = v_rl.run_id and seq = v_rl.seq;
    if v_r.project_id is not null then
      insert into projects.events (project_id, user_id, username, action, detail) values (v_r.project_id, v_user.id, v_user.username, 'answer not taken into the library', left(v_rl.spec_text, 200));
    end if;
  else
    raise exception 'INVALID:decision';
  end if;
  perform core.audit('projects', 'review_' || p_decision, jsonb_build_object('run', v_rl.run_id, 'seq', v_rl.seq, 'line', v_rl.line_id));
end $$;
revoke execute on function public.projects_review_decide(uuid, integer, text, uuid, text, text) from public, anon;
grant execute on function public.projects_review_decide(uuid, integer, text, uuid, text, text) to authenticated;

-- Right 'review': load a filled compliance sheet into a factory's library. p_rows: [{ spec, compliance, remarks,
-- comments, sr, type, part, section, section_sr }] (at most 20000), the rows with an answer or a comment. The six
-- answers are put in their standard words; the last of a repeated clause wins; clauses under 8 characters are skipped.
-- A new clause becomes a library line in its Part and section; an open line is filled; an answered line gets the file's
-- answer (an editor's upload replaces existing answers, counted as 'replaced'). One 'library-upload' run is recorded.
create or replace function public.projects_lib_import(p_factory_id text, p_file_name text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_f projects.factories; v_run uuid; r record; v_l projects.lines; v_has boolean;
        v_unique integer := 0; v_added integer := 0; v_updated integer := 0; v_replaced integer := 0; v_std integer := 0; v_n integer; v_line uuid;
begin
  v_user := core.require_tile('projects', 'review');
  v_f := projects.factory(p_factory_id);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'INVALID:rows'; end if;
  v_n := jsonb_array_length(p_rows);
  if v_n > 20000 then raise exception 'INVALID:rows'; end if;
  insert into projects.runs (kind, user_id, username, product_id, factory_id, source, file_name, line_count)
  values ('library-upload', v_user.id, v_user.username, v_f.product_id, v_f.id, '', left(coalesce(p_file_name, ''), 200), v_n) returning id into v_run;
  select count(*) into v_std from jsonb_array_elements(p_rows) x
   where trim(coalesce(x.value ->> 'compliance', '')) <> '' and projects.choice_of(x.value ->> 'compliance', x.value ->> 'remarks') <> left(trim(coalesce(x.value ->> 'compliance', '')), 200)
     and projects.choice_of(x.value ->> 'compliance', x.value ->> 'remarks') in ('', 'Comply', 'Comply with Remarks', 'Noted', 'Not Comply', 'Not Applicable', 'In Contractor''s Scope');
  for r in
    select distinct on (norm) * from (
      select projects.cm_norm(x.value ->> 'spec') as norm, left(trim(coalesce(x.value ->> 'spec', '')), 6000) as spec,
             left(projects.choice_of(x.value ->> 'compliance', x.value ->> 'remarks'), 200) as c, left(trim(coalesce(x.value ->> 'remarks', '')), 4000) as m,
             left(trim(coalesce(x.value ->> 'comments', '')), 4000) as cm, left(trim(coalesce(x.value ->> 'sr', '')), 20) as sr,
             case when x.value ->> 'type' in ('letter', 'number', 'text') then x.value ->> 'type' else 'text' end as row_type,
             case when coalesce(x.value ->> 'part', '') ~ '^[0-9]$' then (x.value ->> 'part')::int else 0 end as part,
             left(trim(coalesce(x.value ->> 'section', '')), 120) as section, left(trim(coalesce(x.value ->> 'section_sr', '')), 20) as section_sr,
             x.ordinality as ord
      from jsonb_array_elements(p_rows) with ordinality x) s
    where char_length(norm) >= 8 and (c <> '' or m <> '' or cm <> '')
    order by norm, ord desc
  loop
    v_has := r.c <> '' or r.m <> '';
    if v_has then v_unique := v_unique + 1; end if;
    select * into v_l from projects.lines l where l.factory_id = v_f.id and l.norm_hash = md5(r.norm);
    if v_l.id is null then
      insert into projects.lines (product_id, factory_id, norm_hash, norm_text, spec_text, compliance, remarks, comments, status, first_run_id,
                                  answered_by, answered_at, answer_source, times_seen, part, section, sr, row_type, section_sr, home_run, home_seq)
      values (v_f.product_id, v_f.id, md5(r.norm), r.norm, r.spec, r.c, r.m, r.cm, case when v_has then 'answered' else 'open' end, v_run,
              case when v_has then v_user.id end, case when v_has then now() end, case when v_has then 'upload' else '' end, 0,
              r.part, r.section, r.sr, r.row_type, r.section_sr, v_run, r.ord::int)
      returning id into v_line;
      if v_has then
        v_added := v_added + 1;
        insert into projects.answer_log (line_id, compliance, remarks, source, run_id, user_id) values (v_line, r.c, r.m, 'upload', v_run, v_user.id);
      end if;
      continue;
    end if;
    if r.cm <> '' and v_l.comments <> r.cm then update projects.lines set comments = r.cm where id = v_l.id; end if;
    if not v_has then v_l := null; continue; end if;
    if v_l.status = 'answered' then
      if v_l.compliance = r.c and v_l.remarks = r.m then v_l := null; continue; end if;
      v_replaced := v_replaced + 1;
    else
      v_updated := v_updated + 1;
    end if;
    update projects.lines set compliance = r.c, remarks = r.m, status = 'answered', answered_by = v_user.id, answered_at = now(), answer_source = 'upload' where id = v_l.id;
    insert into projects.answer_log (line_id, compliance, remarks, source, run_id, user_id) values (v_l.id, r.c, r.m, 'upload', v_run, v_user.id);
    v_l := null;
  end loop;
  update projects.runs set unique_count = v_unique, matched_count = v_added + v_updated where id = v_run;
  perform core.audit('projects', 'lib_import', jsonb_build_object('factory', v_f.id, 'file', left(coalesce(p_file_name, ''), 200), 'rows', v_n,
                                                                  'added', v_added, 'updated', v_updated, 'replaced', v_replaced, 'standardised', v_std));
  return jsonb_build_object('rows', v_n, 'unique_lines', v_unique, 'added', v_added, 'updated', v_updated, 'replaced', v_replaced,
                            'unchanged', v_unique - v_added - v_updated - v_replaced, 'skipped', v_n - v_unique, 'standardised', v_std);
end $$;
revoke execute on function public.projects_lib_import(text, text, jsonb) from public, anon;
grant execute on function public.projects_lib_import(text, text, jsonb) to authenticated;

-- Right 'review': recent conversions and library uploads, newest first (with the project code when the record is in one).
create or replace function public.projects_lib_runs(p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_tile('projects', 'review');
  return jsonb_build_object('total', (select count(*) from projects.runs),
    'runs', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'created_at', r.created_at, 'user', r.username,
               'product', pd.name, 'factory', f.name, 'source', r.source, 'file_name', r.file_name, 'line_count', r.line_count,
               'unique_count', r.unique_count, 'matched_count', r.matched_count, 'project_code', coalesce(p.code, '')) order by r.created_at desc), '[]'::jsonb)
             from (select * from projects.runs x order by x.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) r
             join projects.products pd on pd.id = r.product_id join projects.factories f on f.id = r.factory_id
             left join projects.projects p on p.id = r.project_id));
end $$;
revoke execute on function public.projects_lib_runs(integer, integer) from public, anon;
grant execute on function public.projects_lib_runs(integer, integer) to authenticated;

-- Right 'review': everything of a factory's library in reading order, for the Excel download; with a project code,
-- only the lines of that project's specifications, in their order there. Every line carries its project codes.
create or replace function public.projects_lib_export(p_factory_id text, p_project_code text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_f projects.factories; v_code text;
begin
  perform core.require_tile('projects', 'review');
  v_f := projects.factory(p_factory_id);
  v_code := upper(trim(coalesce(p_project_code, '')));
  return jsonb_build_object('code', v_code,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('spec_text', l.spec_text, 'compliance', l.compliance, 'remarks', l.remarks, 'comments', l.comments,
               'times_seen', l.times_seen, 'part', l.part, 'section', l.section, 'topic', projects.topic(l.section), 'sr', l.sr, 'row_type', l.row_type,
               'section_sr', l.section_sr, 'home_run', l.home_run, 'file_name', o.file_name, 'project_codes', to_jsonb(o.codes)) order by o.ord), '[]'::jsonb)
             from projects.library_rows(v_f.id, v_code) o join projects.lines l on l.id = o.id));
end $$;
revoke execute on function public.projects_lib_export(text, text) from public, anon;
grant execute on function public.projects_lib_export(text, text) to authenticated;

-- The super user only: clean a factory's library (or every factory of a product). Without p_with_projects: answers,
-- comments, answer history and the conversion / upload history outside projects are cleared; clauses no project uses
-- are deleted; clauses used by project records stay empty so those records still open, and the answers users typed
-- there go back to review. With it, the product's specifications saved in projects go too. Nothing else is touched.
create or replace function public.projects_lib_reset(p_product_id text, p_factory_id text default null, p_with_projects boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_ids text[]; v_records integer := 0; v_history integer; v_gone integer; v_kept integer;
begin
  v_user := core.require_tile('projects', null);
  if not v_user.is_super then raise exception 'NO_RIGHT'; end if;
  if not exists (select 1 from projects.products p where p.id = p_product_id) then raise exception 'INVALID:product_id'; end if;
  select array_agg(f.id) into v_ids from projects.factories f where f.product_id = p_product_id and (p_factory_id is null or p_factory_id = '' or f.id = p_factory_id);
  if v_ids is null then raise exception 'INVALID:factory_id'; end if;
  if coalesce(p_with_projects, false) then
    with d as (delete from projects.runs r where r.factory_id = any (v_ids) and r.project_id is not null returning 1) select count(*) into v_records from d;
  end if;
  with d as (delete from projects.runs r where r.factory_id = any (v_ids) and r.project_id is null returning 1) select count(*) into v_history from d;
  with d as (delete from projects.lines l where l.factory_id = any (v_ids) and not exists (select 1 from projects.run_lines rl where rl.line_id = l.id) returning 1)
  select count(*) into v_gone from d;
  delete from projects.answer_log a where a.line_id in (select l.id from projects.lines l where l.factory_id = any (v_ids));
  update projects.lines set compliance = '', remarks = '', comments = '', status = 'open', answered_by = null, answered_at = null, answer_source = '', times_seen = 1
   where factory_id = any (v_ids);
  update projects.run_lines set review = 'pending', reviewed_by = null, reviewed_at = null
   where line_id is not null and (compliance <> '' or remarks <> '') and review in ('', 'approved')
     and run_id in (select r.id from projects.runs r where r.factory_id = any (v_ids));
  select count(*) into v_kept from projects.lines l where l.factory_id = any (v_ids);
  perform core.audit('projects', 'lib_reset', jsonb_build_object('product', p_product_id, 'factory', p_factory_id, 'with_projects', coalesce(p_with_projects, false),
                                                                 'lines_removed', v_gone, 'lines_kept', v_kept, 'history_removed', v_history, 'records_removed', v_records));
  return jsonb_build_object('lines_removed', v_gone, 'lines_kept', v_kept, 'history_removed', v_history, 'records_removed', v_records);
end $$;
revoke execute on function public.projects_lib_reset(text, text, boolean) from public, anon;
grant execute on function public.projects_lib_reset(text, text, boolean) to authenticated;

select core.applied('projects', '007_review');
