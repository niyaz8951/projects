-- Projects tile: the Compliance of a clause is picked from a list, never typed (owner, 2026-11-05: "making editing go away as
-- user must always select from drop down only; if anything is needed admin can add in drop down; remarks column as it is").
-- The list is the setting 'answer_choices' (Matching rules > Answers, right 'review'); without it, the six standard answers.
-- The record, Focus mode and Compliance review offer only the list; the database refuses anything else on the three typed
-- paths (projects_run_save_line, projects_run_fill_section, projects_lib_save_answer) with INVALID:compliance. An answer
-- in other words is first put in its standard words (projects.choice_of: "by contractor" -> "In Contractor's Scope") and
-- matched without regard to case; an answer saved before and not changed now is kept as it is (only its Remarks change).
-- Uploads of filled Excel files keep their own standard-words mapping. The bodies of the three functions are those of
-- 009 / 007 with only the answer line changed.
-- Touches only: schema projects and functions public.projects_*. Run after 013_hints.sql.

-- ---------------------------------------------------------------------------
-- 1. The settings check, with 'answer_choices'
-- ---------------------------------------------------------------------------

create or replace function projects.settings_check(p_key text, v jsonb)
returns text language plpgsql immutable as $$
declare
  nums constant jsonb := '{"near_words":[0,30],"max_clauses":[1,10],"keep_share":[0,100],"heading_words":[1,30],"label_chars":[10,200],
                           "figure_words":[1,40],"option_values":[1,300],"candidates_shown":[1,100],"choose_listed":[1,20],"vocab_types":[1,10]}';
  fams constant text[] := array['length','mass','areal_mass','density','u_value','pressure','flow','power','velocity','time','temperature'];
  idre constant text := '^[a-z][a-z0-9_]{0,29}$';
  e jsonb; x jsonb; i integer := 0; n numeric; k text;
begin
  if p_key in ('near_words','max_clauses','keep_share','heading_words','label_chars','figure_words','option_values','candidates_shown','choose_listed','vocab_types') then
    if jsonb_typeof(v) <> 'number' then return 'a whole number'; end if;
    n := v::text::numeric;
    if n <> trunc(n) or n < (nums -> p_key ->> 0)::numeric or n > (nums -> p_key ->> 1)::numeric then
      return 'a whole number from ' || (nums -> p_key ->> 0) || ' to ' || (nums -> p_key ->> 1);
    end if;
    return '';
  end if;

  if p_key = 'topics' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) not between 1 and 40 then return '1 to 40 topics'; end if;
    for e in select a.value from jsonb_array_elements(v) a loop
      i := i + 1;
      if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'id') <> 'string' or (e ->> 'id') !~ idre then return 'topic ' || i || ': a short name'; end if;
      if jsonb_typeof(e -> 'words') <> 'array' or jsonb_array_length(e -> 'words') not between 1 and 80 then return 'topic ' || i || ': 1 to 80 words'; end if;
      if exists (select 1 from jsonb_array_elements(e -> 'words') w
                  where jsonb_typeof(w.value) <> 'string' or char_length(w.value #>> '{}') > 60
                     or (w.value #>> '{}') !~ '^[a-z0-9]+\*?( [a-z0-9]+\*?)*$') then
        return 'topic ' || i || ': words of small letters and digits, "*" only at a word end';
      end if;
    end loop;
    if (select count(distinct a.value ->> 'id') from jsonb_array_elements(v) a) <> jsonb_array_length(v) then return 'a topic is listed twice'; end if;
    return '';
  end if;

  if p_key = 'general_topics' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 40
       or exists (select 1 from jsonb_array_elements(v) a where jsonb_typeof(a.value) <> 'string' or (a.value #>> '{}') !~ idre) then return 'topic names'; end if;
    return '';
  end if;

  if p_key = 'section_topics' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 60 then return 'at most 60 lines'; end if;
    for e in select a.value from jsonb_array_elements(v) a loop
      i := i + 1;
      if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'section') <> 'string' or char_length(e ->> 'section') > 80
         or (e ->> 'section') !~ '^[a-z0-9]+( [a-z0-9]+)*$' then return 'line ' || i || ': the section name'; end if;
      if coalesce(e ->> 'how', '') not in ('is', 'starts') then return 'line ' || i || ': is or starts with'; end if;
      if jsonb_typeof(e -> 'topics') <> 'array' or jsonb_array_length(e -> 'topics') not between 1 and 20
         or exists (select 1 from jsonb_array_elements(e -> 'topics') t where jsonb_typeof(t.value) <> 'string' or (t.value #>> '{}') !~ idre) then
        return 'line ' || i || ': one or more topics';
      end if;
    end loop;
    return '';
  end if;

  if p_key = 'parts' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) not between 1 and 5
       or exists (select 1 from jsonb_array_elements(v) a where jsonb_typeof(a.value) <> 'number' or (a.value::text) !~ '^[1-9]$')
       or (select count(distinct a.value) from jsonb_array_elements(v) a) <> jsonb_array_length(v) then
      return '1 to 5 different Part numbers from 1 to 9';
    end if;
    return '';
  end if;

  if p_key = 'heading_verbs' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 20
       or exists (select 1 from jsonb_array_elements(v) a where jsonb_typeof(a.value) <> 'string' or (a.value #>> '{}') !~ '^[a-z]{2,20}$') then
      return 'single words of small letters';
    end if;
    return '';
  end if;

  if p_key = 'properties' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) not between 1 and 80 then return '1 to 80 properties'; end if;
    for e in select a.value from jsonb_array_elements(v) a loop
      i := i + 1;
      if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'name') <> 'string' or trim(e ->> 'name') = '' or char_length(e ->> 'name') > 80 then
        return 'property ' || i || ': a name up to 80 characters';
      end if;
      if jsonb_typeof(e -> 'terms') <> 'array' or jsonb_array_length(e -> 'terms') not between 1 and 30
         or exists (select 1 from jsonb_array_elements(e -> 'terms') t
                     where jsonb_typeof(t.value) <> 'string' or char_length(t.value #>> '{}') not between 1 and 60
                        or (t.value #>> '{}') <> lower(t.value #>> '{}') or (t.value #>> '{}') <> trim(t.value #>> '{}')) then
        return 'property ' || i || ': 1 to 30 words in small letters';
      end if;
      if coalesce(e ->> 'direction', '') not in ('higher', 'lower', 'exact') then return 'property ' || i || ': higher, lower or exact'; end if;
      if jsonb_typeof(e -> 'unit') <> 'string' or ((e ->> 'unit') <> '' and not (e ->> 'unit') = any (fams)) then return 'property ' || i || ': a kind of figure from the list'; end if;
      if jsonb_typeof(e -> 'scale') <> 'array' or jsonb_array_length(e -> 'scale') > 30
         or exists (select 1 from jsonb_array_elements(e -> 'scale') c where jsonb_typeof(c.value) <> 'string' or (c.value #>> '{}') !~ '^[A-Z]{1,3}[0-9]{1,2}$') then
        return 'property ' || i || ': classes such as G4, F7, TB2';
      end if;
    end loop;
    return '';
  end if;

  if p_key = 'vocab_fallback' then           -- 011: keywords for a covered row the vocabulary finds nothing for
    if jsonb_typeof(v) <> 'boolean' then return 'yes or no'; end if;
    return '';
  end if;

  if p_key = 'vocab_products' then           -- 011: the products matched by the vocabulary
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 20
       or exists (select 1 from jsonb_array_elements(v) a where jsonb_typeof(a.value) <> 'string' or (a.value #>> '{}') !~ '^[a-z0-9_-]{1,40}$')
       or (select count(distinct a.value) from jsonb_array_elements(v) a) <> jsonb_array_length(v) then
      return 'product ids';
    end if;
    return '';
  end if;

  if p_key in ('hint_scope', 'hint_absent') then        -- 013
    if jsonb_typeof(v) <> 'boolean' then return 'yes or no'; end if;
    return '';
  end if;

  if p_key = 'scope_parts' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 5
       or exists (select 1 from jsonb_array_elements(v) a where jsonb_typeof(a.value) <> 'number' or (a.value::text) !~ '^[1-9]$')
       or (select count(distinct a.value) from jsonb_array_elements(v) a) <> jsonb_array_length(v) then
      return 'up to 5 different Part numbers from 1 to 9';
    end if;
    return '';
  end if;

  if p_key in ('scope_words', 'scope_sections', 'scope_manufacturer') then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 200
       or exists (select 1 from jsonb_array_elements(v) a where jsonb_typeof(a.value) <> 'string' or char_length(a.value #>> '{}') > 60
                     or (a.value #>> '{}') !~ '^[a-z0-9]+\*?( [a-z0-9]+\*?)*$') then
      return 'words of small letters and digits';
    end if;
    return '';
  end if;

  if p_key = 'absent_rules' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 100 then return 'at most 100 rules'; end if;
    for e in select a.value from jsonb_array_elements(v) a loop
      i := i + 1;
      if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'label') <> 'string' or trim(e ->> 'label') = '' or char_length(e ->> 'label') > 120 then return 'rule ' || i || ': the text'; end if;
      if jsonb_typeof(e -> 'products') <> 'array' or jsonb_array_length(e -> 'products') > 20
         or exists (select 1 from jsonb_array_elements(e -> 'products') x where jsonb_typeof(x.value) <> 'string' or (x.value #>> '{}') !~ '^[a-z0-9_-]{1,40}$') then
        return 'rule ' || i || ': products';
      end if;
      foreach k in array array['clause', 'has', 'lacks'] loop
        n := case when k = 'clause' then 60 else 40 end;
        if jsonb_typeof(e -> k) <> 'array' or jsonb_array_length(e -> k) > n
           or exists (select 1 from jsonb_array_elements(e -> k) x where jsonb_typeof(x.value) <> 'string' or char_length(x.value #>> '{}') > 60
                         or (x.value #>> '{}') !~ '^[a-z0-9]+\*?( [a-z0-9]+\*?)*$') then
          return 'rule ' || i || ': ' || k;
        end if;
      end loop;
      if jsonb_array_length(e -> 'clause') = 0 then return 'rule ' || i || ': clause words'; end if;
      if jsonb_array_length(e -> 'has') = 0 and jsonb_array_length(e -> 'lacks') = 0 then return 'rule ' || i || ': has or lacks'; end if;
    end loop;
    return '';
  end if;

  if p_key = 'answer_choices' then                     -- 014
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) not between 1 and 20
       or exists (select 1 from jsonb_array_elements(v) a where jsonb_typeof(a.value) <> 'string' or char_length(a.value #>> '{}') not between 1 and 60
                     or (a.value #>> '{}') <> trim(a.value #>> '{}') or (a.value #>> '{}') ~ '[[:cntrl:]]')
       or (select count(distinct lower(a.value #>> '{}')) from jsonb_array_elements(v) a) <> jsonb_array_length(v) then
      return '1 to 20 different answers of 1 to 60 characters';
    end if;
    return '';
  end if;

  return 'unknown setting';
end $$;

-- ---------------------------------------------------------------------------
-- 2. The list and the check of one answer
-- ---------------------------------------------------------------------------

-- The answers in their order: the setting, else the six standard ones.
create or replace function projects.answer_choices()
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce((select array_agg(e.value #>> '{}' order by e.ordinality) from projects.settings s, jsonb_array_elements(s.value) with ordinality e
                    where s.key = 'answer_choices' and jsonb_typeof(s.value) = 'array'),
                  array['Comply', 'Comply with Remarks', 'Noted', 'Not Comply', 'Not Applicable', 'In Contractor''s Scope']);
$$;

-- The answer to store: '' for none; the answer of the list it names (standard words, any case); p_kept (the answer the
-- clause holds now) when unchanged, even if no longer in the list; anything else INVALID:compliance.
create or replace function projects.answer_pick(p_value text, p_remarks text, p_kept text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare raw text := left(trim(coalesce(p_value, '')), 200); v text; hit text;
begin
  if raw = '' then return ''; end if;
  if p_kept is not null and raw = p_kept then return raw; end if;
  v := projects.choice_of(raw, p_remarks);
  if v = '' then return ''; end if;
  select c into hit from unnest(projects.answer_choices()) c where lower(c) = lower(v) limit 1;
  if hit is null then raise exception 'INVALID:compliance'; end if;
  return hit;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The three typed paths (bodies of 009 / 007, the answer checked)
-- ---------------------------------------------------------------------------

create or replace function public.projects_run_save_line(p_run_id uuid, p_seq integer, p_compliance text, p_remarks text, p_check text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_r projects.runs; v_rl projects.run_lines; v_review text;
begin
  v_user := core.require_tile('projects', null);
  v_r := projects.run_in_project(v_user, p_run_id);
  select * into v_rl from projects.run_lines rl where rl.run_id = v_r.id and rl.seq = p_seq;
  if not found or v_rl.line_id is null then raise exception 'INVALID:seq'; end if;
  perform projects.check_row(v_rl.spec_text, p_check);
  v_review := projects.answer_line(v_user, v_r.id, v_rl.seq, projects.answer_pick(p_compliance, p_remarks, v_rl.compliance), left(trim(coalesce(p_remarks, '')), 4000));
  perform projects.log_hourly(v_user, v_r.project_id, 'compliance filled online', coalesce(nullif(v_r.file_name, ''), 'pasted text'));
  return jsonb_build_object('review', v_review);
end $$;
revoke execute on function public.projects_run_save_line(uuid, integer, text, text, text) from public, anon;
grant execute on function public.projects_run_save_line(uuid, integer, text, text, text) to authenticated;

create or replace function public.projects_run_fill_section(p_run_id uuid, p_seq integer, p_compliance text, p_replace boolean default false, p_check text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_r projects.runs; v_h projects.run_lines; v_end integer; r record; v_c text; v_n integer := 0; v_kept integer := 0; v_own boolean; v_lib boolean;
begin
  v_user := core.require_tile('projects', null);
  v_r := projects.run_in_project(v_user, p_run_id);
  select * into v_h from projects.run_lines rl where rl.run_id = v_r.id and rl.seq = p_seq;
  if not found or v_h.type <> 'section' then raise exception 'INVALID:seq'; end if;
  perform projects.check_row(v_h.spec_text, p_check);
  v_c := projects.answer_pick(p_compliance, '', null);
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

create or replace function public.projects_lib_save_answer(p_line_id uuid, p_compliance text, p_remarks text, p_comments text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_l projects.lines; v_c text; v_r text; v_status text;
begin
  v_user := core.require_tile('projects', 'review');
  select * into v_l from projects.lines l where l.id = p_line_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_c := projects.answer_pick(p_compliance, p_remarks, v_l.compliance); v_r := left(trim(coalesce(p_remarks, '')), 4000);
  if p_comments is not null then update projects.lines set comments = left(trim(p_comments), 4000) where id = v_l.id; end if;
  if v_l.compliance = v_c and v_l.remarks = v_r then return jsonb_build_object('status', v_l.status); end if;
  v_status := case when v_c <> '' or v_r <> '' then 'answered' else 'open' end;
  update projects.lines set compliance = v_c, remarks = v_r, status = v_status, answered_by = v_user.id, answered_at = now(), answer_source = 'admin' where id = v_l.id;
  insert into projects.answer_log (line_id, compliance, remarks, source, user_id) values (v_l.id, v_c, v_r, 'admin', v_user.id);
  return jsonb_build_object('status', v_status);
end $$;
revoke execute on function public.projects_lib_save_answer(uuid, text, text, text) from public, anon;
grant execute on function public.projects_lib_save_answer(uuid, text, text, text) to authenticated;

select core.applied('projects', '014_answer_list');
