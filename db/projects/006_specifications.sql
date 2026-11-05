-- Projects tile, step 3 (Specification and record): the converted specifications of a project (records), the factory
-- compliance library the clauses enter, the answers per project and the review flag. Rewritten from the old tool's
-- cm_save_run (worker/src/api/cm.ts), pr_run_get / pr_run_save_line / pr_run_fill_section / pr_run_save_review /
-- pr_run_save_comment / pr_run_split / pr_run_join / pr_delete_record / pr_submit_answers / pr_export (pr.ts) and
-- lib/cm.ts, with the same checks. The specification PDF is never stored: only its rows (owner, 2026-11-05).
-- Review of the users' answers into the library (pr_review_*) and the library pages (cm_admin_*) come in step 4.
-- Also replaces projects_list and projects_get (records with their counts). Touches only: schema projects and
-- functions public.projects_*. Run after 005_datasheets.sql.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- One converted specification (the old cm_runs). A record leaves its project by setting project_id null; it stays in
-- the library's conversion history.
create table projects.runs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'conversion' check (kind in ('conversion', 'library-upload')),
  user_id       uuid,
  username      text not null default '',
  product_id    text not null references projects.products (id),
  factory_id    text not null references projects.factories (id),
  source        text not null default '' check (source in ('', 'pdf', 'text')),
  file_name     text not null default '' check (char_length(file_name) <= 200),
  line_count    integer not null default 0,
  unique_count  integer not null default 0,
  matched_count integer not null default 0,
  project_id    uuid references projects.projects (id) on delete set null,
  created_at    timestamptz not null default now()
);
alter table projects.runs enable row level security;
create index runs_project_idx on projects.runs (project_id, created_at);
create index runs_factory_idx on projects.runs (factory_id, created_at);

-- The factory compliance library (the old cm_lines): every clause met, once per factory, keyed by its normalised text.
create table projects.lines (
  id            uuid primary key default gen_random_uuid(),
  product_id    text not null references projects.products (id),
  factory_id    text not null references projects.factories (id),
  norm_hash     text not null,                    -- md5 of norm_text: the match key
  norm_text     text not null,
  spec_text     text not null,
  compliance    text not null default '',
  remarks       text not null default '',
  comments      text not null default '',         -- Internal Comments (text after '#' is for the reviewers only)
  status        text not null default 'open' check (status in ('open', 'answered')),
  times_seen    integer not null default 0,
  first_run_id  uuid references projects.runs (id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  answered_by   uuid,
  answered_at   timestamptz,
  answer_source text not null default '',         -- admin | upload | approved
  part          integer not null default 0,
  section       text not null default '',
  home_run      uuid references projects.runs (id) on delete set null,
  home_seq      integer,
  sr            text not null default '',
  row_type      text not null default '',
  section_sr    text not null default '',
  unique (factory_id, norm_hash)
);
alter table projects.lines enable row level security;
create index lines_list_idx on projects.lines (factory_id, status);

-- Every row of a converted specification, with the project's own answer (the old cm_run_lines).
create table projects.run_lines (
  run_id        uuid not null references projects.runs (id) on delete cascade,
  seq           integer not null,
  type          text not null default '',
  sr            text not null default '',
  spec_text     text not null default '',
  line_id       uuid references projects.lines (id) on delete set null,
  compliance    text not null default '',
  remarks       text not null default '',
  answered_by   uuid,
  answered_at   timestamptz,
  review        text not null default '' check (review in ('', 'pending', 'approved', 'rejected')),
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  tl_review     text not null default '',
  primary key (run_id, seq)
);
alter table projects.run_lines enable row level security;
create index run_lines_line_idx on projects.run_lines (line_id);
create index run_lines_review_idx on projects.run_lines (review) where review = 'pending';

-- What the library's answer was each time it changed (the old cm_answer_log).
create table projects.answer_log (
  id         bigint generated always as identity primary key,
  line_id    uuid not null references projects.lines (id) on delete cascade,
  compliance text not null default '',
  remarks    text not null default '',
  source     text not null default '',
  run_id     uuid references projects.runs (id) on delete set null,
  user_id    uuid,
  created_at timestamptz not null default now()
);
alter table projects.answer_log enable row level security;
create index answer_log_line_idx on projects.answer_log (line_id, created_at);

-- ---------------------------------------------------------------------------
-- 2. Pure helpers (the old lib/cm.ts)
-- ---------------------------------------------------------------------------

-- The one place text is normalised for matching: lower case, punctuation and spacing ignored.
create or replace function projects.cm_norm(p_text text)
returns text language sql immutable as $$
  select trim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', ' ', 'g'));
$$;

-- Body rows enter the library: letter / number / text, 8+ characters after normalising, not a contents line.
create or replace function projects.library_key(p_type text, p_spec text)
returns text language plpgsql immutable as $$
declare n text;
begin
  if p_type not in ('letter', 'number', 'text') then return null; end if;
  n := projects.cm_norm(p_spec);
  if char_length(n) < 8 or coalesce(p_spec, '') ~ '\.{5,}' then return null; end if;
  return n;
end $$;

-- "PART 2 - PRODUCTS" -> 2. Anything else -> 0.
create or replace function projects.part_no(p_text text)
returns integer language plpgsql immutable as $$
declare m text[];
begin
  m := regexp_match(coalesce(p_text, ''), '^\s*PART\s+([0-9]{1,2}|I{1,3})\M', 'i');
  if m is null then return 0; end if;
  return case upper(m[1]) when 'I' then 1 when 'II' then 2 when 'III' then 3 else least(m[1]::integer, 9) end;
end $$;

-- pr__check_row: the first 40 letters and digits of the clause as the page shows it.
create or replace function projects.row_key(p_spec text)
returns text language sql immutable as $$
  select left(regexp_replace(lower(coalesce(p_spec, '')), '[^a-z0-9]+', '', 'g'), 40);
$$;

-- The Part, section and section number every row of a record sits under (placeRows).
create or replace function projects.place_rows(p_run_id uuid)
returns table (seq integer, part integer, section text, section_sr text) language plpgsql stable security definer set search_path = '' as $$
declare r record; v_part integer := 0; v_section text := ''; v_sr text := ''; pn integer;
begin
  for r in select rl.seq, rl.type, rl.sr, rl.spec_text from projects.run_lines rl where rl.run_id = p_run_id order by rl.seq loop
    if r.type = 'part' then
      pn := projects.part_no(r.spec_text);
      if pn > 0 then v_part := pn; v_section := ''; v_sr := ''; end if;
      continue;
    end if;
    if r.type = 'section' then
      if r.spec_text !~ '\.{5,}' and coalesce(r.sr, '') !~ '^0\.' then v_section := left(trim(r.spec_text), 120); v_sr := left(trim(coalesce(r.sr, '')), 12); end if;
      continue;
    end if;
    seq := r.seq; part := v_part; section := v_section; section_sr := v_sr;
    return next;
  end loop;
end $$;

-- The record, if it is in a project the caller may open; NOT_FOUND otherwise (never NO_RIGHT).
create or replace function projects.run_in_project(p_user core.profiles, p_run_id uuid)
returns projects.runs language plpgsql stable security definer set search_path = '' as $$
declare v_r projects.runs; v_p projects.projects;
begin
  select * into v_r from projects.runs r where r.id = p_run_id;
  if not found or v_r.project_id is null then raise exception 'NOT_FOUND'; end if;
  select * into v_p from projects.projects p where p.id = v_r.project_id;
  if not found or not projects.can_open(p_user, v_p) then raise exception 'NOT_FOUND'; end if;
  return v_r;
end $$;

-- The row a page means must still be the row with that number (p_check null = no check).
create or replace function projects.check_row(p_spec text, p_check text)
returns void language plpgsql immutable as $$
begin
  if p_check is not null and projects.row_key(p_spec) <> p_check then raise exception 'INVALID:check'; end if;
end $$;

-- Find or create the library line of a clause of a run; null when the clause is too short for the library.
create or replace function projects.run_line(p_run projects.runs, p_type text, p_spec text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare n text; h text; v_id uuid;
begin
  n := projects.library_key(p_type, p_spec);
  if n is null then return null; end if;
  h := md5(n);
  select l.id into v_id from projects.lines l where l.factory_id = p_run.factory_id and l.norm_hash = h;
  if found then return v_id; end if;
  insert into projects.lines (product_id, factory_id, norm_hash, norm_text, spec_text, first_run_id, times_seen, home_run)
  values (p_run.product_id, p_run.factory_id, h, n, p_spec, p_run.id, 1, p_run.id)
  returning id into v_id;
  return v_id;
end $$;

-- A library line made only by a wrong row and never answered is removed.
create or replace function projects.drop_unused_line(p_line_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_line_id is null then return; end if;
  if exists (select 1 from projects.run_lines rl where rl.line_id = p_line_id) then return; end if;
  delete from projects.lines l where l.id = p_line_id and l.status = 'open' and l.comments = '' and l.times_seen <= 1;
end $$;

-- Writes a person's answer on one row: equal to the library answer = nothing more to do (review ''); anything else
-- waits for review; both boxes empty takes the project's own answer away. Returns the review state written.
create or replace function projects.answer_line(p_user core.profiles, p_run_id uuid, p_seq integer, p_c text, p_m text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_review text := ''; v_l projects.lines; v_line uuid;
begin
  select rl.line_id into v_line from projects.run_lines rl where rl.run_id = p_run_id and rl.seq = p_seq;
  if p_c = '' and p_m = '' then
    update projects.run_lines set compliance = '', remarks = '', answered_by = null, answered_at = null, review = '', reviewed_by = null, reviewed_at = null
     where run_id = p_run_id and seq = p_seq;
    return '';
  end if;
  if v_line is not null then select * into v_l from projects.lines l where l.id = v_line; end if;
  v_review := case when v_l.id is not null and v_l.status = 'answered' and v_l.compliance = p_c and v_l.remarks = p_m then '' else 'pending' end;
  update projects.run_lines set compliance = p_c, remarks = p_m, answered_by = p_user.id, answered_at = now(), review = v_review, reviewed_by = null, reviewed_at = null
   where run_id = p_run_id and seq = p_seq;
  return v_review;
end $$;

-- One history line per person, record and hour for repeated actions.
create or replace function projects.log_hourly(p_user core.profiles, p_project_id uuid, p_action text, p_detail text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from projects.events e where e.project_id = p_project_id and e.user_id = p_user.id and e.action = p_action
               and e.detail = left(p_detail, 400) and e.created_at > now() - interval '1 hour') then return; end if;
  insert into projects.events (project_id, user_id, username, action, detail) values (p_project_id, p_user.id, p_user.username, p_action, left(p_detail, 400));
  update projects.projects set updated_by = p_user.id, updated_by_name = p_user.username, updated_at = now() where id = p_project_id;
end $$;

-- After rows were split or joined: the counts of the run, the Part / section / place of its lines, the library's reading order.
create or replace function projects.run_reshaped(p_user core.profiles, p_run projects.runs)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; v_n integer; v_u integer;
begin
  select count(*), count(distinct rl.line_id) into v_n, v_u from projects.run_lines rl where rl.run_id = p_run.id;
  update projects.runs set line_count = v_n, unique_count = v_u where id = p_run.id;
  for r in
    select distinct on (rl.line_id) rl.line_id, rl.seq, rl.type, rl.sr, l.home_run, l.home_seq, l.part, l.section,
           coalesce(pl.part, 0) as n_part, coalesce(pl.section, '') as n_section, coalesce(pl.section_sr, '') as n_sr
    from projects.run_lines rl join projects.lines l on l.id = rl.line_id
    left join projects.place_rows(p_run.id) pl on pl.seq = rl.seq
    where rl.run_id = p_run.id and rl.line_id is not null order by rl.line_id, rl.seq
  loop
    if r.home_run is null or (r.home_run = p_run.id and r.home_seq is null) then
      update projects.lines set part = case when part = 0 then r.n_part else part end, section = case when section = '' then r.n_section else section end,
             home_run = p_run.id, home_seq = r.seq, sr = regexp_replace(r.sr, '[.)]\s*$', ''), row_type = r.type, section_sr = r.n_sr
       where id = r.line_id;
      continue;
    end if;
    if (r.part = 0 and r.n_part > 0) or (r.section = '' and r.n_section <> '') then
      update projects.lines set part = case when part = 0 then r.n_part else part end, section = case when section = '' then r.n_section else section end where id = r.line_id;
    end if;
    if r.home_run = p_run.id and r.home_seq <> r.seq then update projects.lines set home_seq = r.seq where id = r.line_id; end if;
  end loop;
  perform projects.log_hourly(p_user, p_run.project_id, 'rows split or joined', coalesce(nullif(p_run.file_name, ''), 'pasted text'));
end $$;

-- Rows after p_seq move by p_by places (two steps, so no two rows share a number on the way).
create or replace function projects.shift_rows(p_run_id uuid, p_seq integer, p_by integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update projects.run_lines set seq = -(seq + p_by) - 1 where run_id = p_run_id and seq > p_seq;
  update projects.run_lines set seq = -seq - 1 where run_id = p_run_id and seq < 0;
end $$;

-- Internal Comments as a user sees them: the note before '#'; a reviewer sees everything.
create or replace function projects.comments_for(p_comments text, p_reviewer boolean)
returns text language sql immutable as $$
  select case when p_reviewer then coalesce(p_comments, '') else trim(split_part(coalesce(p_comments, ''), '#', 1)) end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Convert: save one specification and get back what the library already holds
-- ---------------------------------------------------------------------------

-- Right 'edit', a project the caller may open. p_lines: [{ type, sr, spec }, ...] in document order, at most 8000.
-- Every row is stored; body rows enter the library once each (first seen wins for Part / section / place).
-- Returns { run_id, lines, unique_lines, matched, answers: [{ i, answered, compliance, remarks, comments }] }.
create or replace function public.projects_run_save(p_project_id uuid, p_factory_id text, p_source text, p_file_name text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_p projects.projects; v_f projects.factories; v_run projects.runs; v_reviewer boolean;
        r record; v_norm text; v_hash text; v_line projects.lines; v_matched integer := 0; v_uniq integer := 0;
        v_answers jsonb := '[]'::jsonb; v_source text; v_file text; v_n integer;
begin
  v_user := core.require_tile('projects', 'edit');
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

-- ---------------------------------------------------------------------------
-- 4. The record: read and fill
-- ---------------------------------------------------------------------------

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
      'can_comment', v_reviewer, 'can_review', v_admin, 'can_edit', core.has_tile(v_user.id, 'projects', 'edit'), 'precedent', v_prec),
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

-- Right 'edit': the answer typed for one row. Equal to the library's = no review; anything else waits for review.
create or replace function public.projects_run_save_line(p_run_id uuid, p_seq integer, p_compliance text, p_remarks text, p_check text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_r projects.runs; v_rl projects.run_lines; v_review text;
begin
  v_user := core.require_tile('projects', 'edit');
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

-- Right 'edit': one answer for every clause of a section (the rows after the heading p_seq down to the next section or
-- PART row). p_replace false = only the clauses that show no answer yet. p_compliance '' takes the project's own answers off.
create or replace function public.projects_run_fill_section(p_run_id uuid, p_seq integer, p_compliance text, p_replace boolean default false, p_check text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_r projects.runs; v_h projects.run_lines; v_end integer; r record; v_c text; v_n integer := 0; v_kept integer := 0; v_own boolean; v_lib boolean;
begin
  v_user := core.require_tile('projects', 'edit');
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

-- Tile admin or super user: the TL Review on one clause of a project record (it never leaves the project).
create or replace function public.projects_run_save_review(p_run_id uuid, p_seq integer, p_text text, p_check text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_r projects.runs; v_rl projects.run_lines;
begin
  v_user := core.require_tile('projects', null);
  v_r := projects.run_in_project(v_user, p_run_id);
  if not core.is_tile_admin(v_user.id, 'projects') then raise exception 'NO_RIGHT'; end if;
  select * into v_rl from projects.run_lines rl where rl.run_id = v_r.id and rl.seq = p_seq;
  if not found or v_rl.type not in ('letter', 'number', 'text') then raise exception 'INVALID:seq'; end if;
  perform projects.check_row(v_rl.spec_text, p_check);
  update projects.run_lines set tl_review = left(trim(coalesce(p_text, '')), 4000) where run_id = v_r.id and seq = v_rl.seq;
end $$;
revoke execute on function public.projects_run_save_review(uuid, integer, text, text) from public, anon;
grant execute on function public.projects_run_save_review(uuid, integer, text, text) to authenticated;

-- Right 'review': Internal Comments written while reading a record (the library's comments for the clause).
create or replace function public.projects_run_save_comment(p_run_id uuid, p_seq integer, p_comments text, p_check text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_r projects.runs; v_rl projects.run_lines;
begin
  v_user := core.require_tile('projects', 'review');
  v_r := projects.run_in_project(v_user, p_run_id);
  select * into v_rl from projects.run_lines rl where rl.run_id = v_r.id and rl.seq = p_seq;
  if not found or v_rl.line_id is null then raise exception 'INVALID:seq'; end if;
  perform projects.check_row(v_rl.spec_text, p_check);
  update projects.lines set comments = left(trim(coalesce(p_comments, '')), 4000) where id = v_rl.line_id;
end $$;
revoke execute on function public.projects_run_save_comment(uuid, integer, text, text) from public, anon;
grant execute on function public.projects_run_save_comment(uuid, integer, text, text) to authenticated;

-- Right 'edit': split one row into several. p_rows: [{ type, sr, spec }, ...], at least two, at most 60. The first keeps
-- the label, type and answer of the row; the words never change (INVALID:rows otherwise).
create or replace function public.projects_run_split(p_run_id uuid, p_seq integer, p_rows jsonb, p_check text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_r projects.runs; v_rl projects.run_lines; v_n integer; v_total integer; x record; v_first uuid; v_line uuid; v_type text; v_bare_in text := ''; v_k integer := 0;
begin
  v_user := core.require_tile('projects', 'edit');
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

-- Right 'edit': join a row to the row above it. The row above keeps its label and type; its own answer wins, else the
-- answer of the joined row is kept. PART rows are never joined; a heading cannot take an answer (INVALID:join).
create or replace function public.projects_run_join(p_run_id uuid, p_seq integer, p_check text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_r projects.runs; a projects.run_lines; b projects.run_lines; v_spec text; v_line uuid; v_keep_b boolean; v_tl text; v_src projects.run_lines; v_c text; v_m text; v_review text;
begin
  v_user := core.require_tile('projects', 'edit');
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

-- Right 'edit': the record leaves the project (it stays in the library's conversion history); answers waiting for
-- review are withdrawn; clauses and approved answers already in the library stay there.
create or replace function public.projects_run_delete(p_run_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_r projects.runs;
begin
  v_user := core.require_tile('projects', 'edit');
  v_r := projects.run_in_project(v_user, p_run_id);
  update projects.run_lines set review = '' where run_id = v_r.id and review = 'pending';
  update projects.runs set project_id = null where id = v_r.id;
  insert into projects.events (project_id, user_id, username, action, detail) values (v_r.project_id, v_user.id, v_user.username, 'compliance record removed', left(v_r.file_name, 400));
  update projects.projects set updated_by = v_user.id, updated_by_name = v_user.username, updated_at = now() where id = v_r.project_id;
  perform core.audit('projects', 'run_delete', jsonb_build_object('project', v_r.project_id, 'run', v_r.id));
end $$;
revoke execute on function public.projects_run_delete(uuid) from public, anon;
grant execute on function public.projects_run_delete(uuid) to authenticated;

-- Right 'edit': the answers read from a filled Excel, p_rows: [{ spec, compliance, remarks }, ...] (at most 20000).
-- Each answer lands on the matching row (same text rule as the library; the last of a repeated clause wins).
create or replace function public.projects_run_submit_answers(p_run_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_r projects.runs; r record; v_stored integer := 0; v_pending integer := 0;
begin
  v_user := core.require_tile('projects', 'edit');
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

-- Anyone with the tile: the APPROVED Product Options values of one factory (never hidden ones), per row, most seen
-- first, with the row's kind from the mapping. What the record's dashed chips and the Selection list are built from.
create or replace function public.projects_po_approved(p_factory_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_f projects.factories;
begin
  perform core.require_tile('projects', null);
  select * into v_f from projects.factories f where f.id = p_factory_id and f.active;
  if not found then raise exception 'INVALID:factory_id'; end if;
  return jsonb_build_object('factory_id', v_f.id, 'factory', v_f.name, 'product_id', v_f.product_id,
    'values', (select coalesce(jsonb_agg(jsonb_build_object('key', v.row_key, 'value', v.value, 'times', v.times, 'grp', v.grp, 'model', v.model,
                                                          'kind', coalesce(m.kind, '')) order by v.times desc, v.value), '[]'::jsonb)
               from projects.po_values v left join projects.dn_map m on m.product_id = v_f.product_id and m.row_key = v.row_key
               where v.factory_id = v_f.id and v.approved and not v.hidden));
end $$;
revoke execute on function public.projects_po_approved(text) from public, anon;
grant execute on function public.projects_po_approved(text) to authenticated;

-- Anyone who may open the project: everything in it for the Excel download (details, every record's rows with the
-- answer that applies, the datasheet tables with their rows). One history line.
create or replace function public.projects_export(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_p projects.projects; v_reviewer boolean;
begin
  v_user := core.require_tile('projects', null);
  select * into v_p from projects.projects p where p.id = p_project_id;
  if not found or not projects.can_open(v_user, v_p) then raise exception 'NOT_FOUND'; end if;
  v_reviewer := core.has_tile(v_user.id, 'projects', 'review');
  insert into projects.events (project_id, user_id, username, action, detail) values (v_p.id, v_user.id, v_user.username, 'project downloaded', '');
  return jsonb_build_object(
    'project', jsonb_build_object('id', v_p.id, 'code', v_p.code, 'name', v_p.name, 'client_type', v_p.client_type, 'client_name', v_p.client_name, 'region', v_p.region,
      'created_by', v_p.created_by_name, 'created_at', v_p.created_at, 'updated_by', v_p.updated_by_name, 'updated_at', v_p.updated_at),
    'runs', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'user', r.username, 'product_id', r.product_id,
               'product', pd.name, 'factory', f.name, 'source', r.source, 'file_name', r.file_name) order by r.created_at desc), '[]'::jsonb)
             from projects.runs r join projects.products pd on pd.id = r.product_id join projects.factories f on f.id = r.factory_id where r.project_id = v_p.id),
    'compliance', (select coalesce(jsonb_agg(jsonb_build_object('run', rl.run_id, 'seq', rl.seq, 'type', rl.type, 'sr', rl.sr, 'spec', rl.spec_text,
               'compliance', case when rl.compliance <> '' or rl.remarks <> '' then rl.compliance else coalesce(case when l.status = 'answered' then l.compliance end, '') end,
               'remarks', case when rl.compliance <> '' or rl.remarks <> '' then rl.remarks else coalesce(case when l.status = 'answered' then l.remarks end, '') end,
               'source', case when rl.compliance <> '' or rl.remarks <> '' then
                                case rl.review when 'pending' then 'Project answer, waiting for review' when 'approved' then 'Project answer, approved for the library'
                                               when 'rejected' then 'Project answer, not taken into the library' else 'Same as the library' end
                              when l.status = 'answered' then 'From the library' else '' end,
               'comments', projects.comments_for(l.comments, v_reviewer), 'by', coalesce(d.username, '')) order by r.created_at, rl.run_id, rl.seq), '[]'::jsonb)
             from projects.run_lines rl join projects.runs r on r.id = rl.run_id left join projects.lines l on l.id = rl.line_id
             left join core.display_names('projects', (select array_agg(distinct x.answered_by) from projects.run_lines x join projects.runs y on y.id = x.run_id where y.project_id = v_p.id and x.answered_by is not null)) d on d.id = rl.answered_by
             where r.project_id = v_p.id),
    'tables', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'product_id', n.product_id, 'product', pd.name, 'file_names', n.file_names,
               'created_at', n.created_at, 'columns', n.columns, 'rows', n.rows) order by n.created_at), '[]'::jsonb)
             from projects.notes n join projects.products pd on pd.id = n.product_id where n.project_id = v_p.id));
end $$;
revoke execute on function public.projects_export(uuid) from public, anon;
grant execute on function public.projects_export(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The register and the project page now carry the records
-- ---------------------------------------------------------------------------

drop function if exists public.projects_list(text, text, text);
create or replace function public.projects_list(p_q text default null, p_region text default null, p_client_type text default null)
returns table (id uuid, code text, name text, client_type text, client_name text, region text,
               created_by_name text, created_at timestamptz, updated_at timestamptz, members integer, notes integer,
               runs integer, pending integer, total integer, sees_all boolean)
language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_all boolean; v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  v_user := core.require_tile('projects', null);
  v_all := core.is_tile_admin(v_user.id, 'projects');
  if char_length(coalesce(v_q, '')) > 120 then raise exception 'INVALID:q'; end if;
  return query
    with hit as (
      select p.* from projects.projects p
      where (v_all or p.created_by = v_user.id
             or exists (select 1 from projects.members m where m.project_id = p.id and m.user_id = v_user.id))
        and (p_region is null or p_region = '' or p.region = p_region)
        and (p_client_type is null or p_client_type = '' or p.client_type = p_client_type)
        and (v_q is null or p.name ilike '%' || v_q || '%' or p.client_name ilike '%' || v_q || '%' or p.code ilike '%' || v_q || '%')
    )
    select h.id, h.code, h.name, h.client_type, h.client_name, h.region,
           h.created_by_name, h.created_at, h.updated_at,
           (select count(*)::integer from projects.members m where m.project_id = h.id),
           (select count(*)::integer from projects.notes n where n.project_id = h.id),
           (select count(*)::integer from projects.runs r where r.project_id = h.id),
           (select count(*)::integer from projects.run_lines rl join projects.runs r on r.id = rl.run_id where r.project_id = h.id and rl.review = 'pending'),
           (select count(*)::integer from hit), v_all
    from hit h order by h.updated_at desc limit 300;
end $$;
revoke execute on function public.projects_list(text, text, text) from public, anon;
grant execute on function public.projects_list(text, text, text) to authenticated;

create or replace function public.projects_get(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_p projects.projects;
begin
  v_user := core.require_tile('projects', null);
  select * into v_p from projects.projects p where p.id = p_id;
  if not found or not projects.can_open(v_user, v_p) then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object(
    'id', v_p.id, 'code', v_p.code, 'name', v_p.name, 'client_type', v_p.client_type,
    'client_name', v_p.client_name, 'region', v_p.region,
    'created_by_name', v_p.created_by_name, 'created_at', v_p.created_at,
    'updated_by_name', v_p.updated_by_name, 'updated_at', v_p.updated_at,
    'can_share', core.is_tile_admin(v_user.id, 'projects'),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('username', d.username, 'display_name', d.display_name,
                                                           'active', d.active, 'added_by_name', m.added_by_name,
                                                           'added_at', m.added_at)
                                          order by d.username), '[]'::jsonb)
                from projects.members m
                join core.display_names('projects', (select array_agg(x.user_id) from projects.members x where x.project_id = v_p.id)) d
                  on d.id = m.user_id
                where m.project_id = v_p.id),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'created_at', n.created_at, 'username', n.username,
                                                         'product_id', n.product_id, 'product', pd.name,
                                                         'factory_id', n.factory_id, 'factory', coalesce(f.name, ''),
                                                         'file_names', n.file_names, 'units', n.units, 'rows', n.row_count)
                                        order by n.created_at desc), '[]'::jsonb)
              from projects.notes n join projects.products pd on pd.id = n.product_id
              left join projects.factories f on f.id = n.factory_id
              where n.project_id = v_p.id),
    'runs', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'user', r.username,
               'product_id', r.product_id, 'product', pd.name, 'factory_id', r.factory_id, 'factory', f.name, 'source', r.source, 'file_name', r.file_name,
               'lines', r.line_count, 'from_library', r.matched_count,
               'clauses', c.clauses, 'filled', c.filled, 'answered', c.answered, 'pending', c.pending, 'approved', c.approved, 'rejected', c.rejected)
               order by r.created_at desc), '[]'::jsonb)
             from projects.runs r join projects.products pd on pd.id = r.product_id join projects.factories f on f.id = r.factory_id
             cross join lateral (
               select count(*) filter (where rl.line_id is not null)::integer as clauses,
                      count(*) filter (where rl.line_id is not null and (rl.compliance <> '' or rl.remarks <> '' or l.status = 'answered'))::integer as filled,
                      count(*) filter (where rl.compliance <> '' or rl.remarks <> '')::integer as answered,
                      count(*) filter (where rl.review = 'pending')::integer as pending,
                      count(*) filter (where rl.review = 'approved')::integer as approved,
                      count(*) filter (where rl.review = 'rejected')::integer as rejected
               from projects.run_lines rl left join projects.lines l on l.id = rl.line_id where rl.run_id = r.id) c
             where r.project_id = v_p.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('username', e.username, 'action', e.action,
                                                          'detail', e.detail, 'created_at', e.created_at)
                                         order by e.id desc), '[]'::jsonb)
               from (select * from projects.events x where x.project_id = v_p.id order by x.id desc limit 100) e));
end $$;
revoke execute on function public.projects_get(uuid) from public, anon;
grant execute on function public.projects_get(uuid) to authenticated;

select core.applied('projects', '006_specifications');
