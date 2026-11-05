-- Projects tile: the Matching rules (owner, 2026-11-05: "cut the map out; one more button beside Compliance review and
-- Product Options, filled with all settings and current assumptions in code; admins review and update it there; no AI,
-- no maps").
-- What decides which datasheet value or Product Options value shows under a clause was written into the browser code
-- (cm-rows.js, pr-picks.js). Those lists and numbers can now be changed by the reviewers without touching the code:
-- a key saved here replaces the built-in value (assets/pr-settings.js holds the built-in ones, the same as the code had);
-- a key not saved keeps it. Every change is kept with who and when, so it can be put back.
-- Who: everyone with the tile reads the settings (the record needs them to show the chips); saving and the history
-- need 'review' (tile admins and the super user hold it).
-- Touches only: schema projects and functions public.projects_*. Run after 009_open_edit.sql.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table projects.settings (
  key             text primary key,
  value           jsonb not null,
  updated_by      uuid,
  updated_by_name text not null default '',
  updated_at      timestamptz not null default now()
);
alter table projects.settings enable row level security;

-- every change: old_value / new_value null = the built-in value
create table projects.settings_log (
  id         bigint generated always as identity primary key,
  key        text not null,
  old_value  jsonb,
  new_value  jsonb,
  by_id      uuid,
  by_name    text not null default '',
  at         timestamptz not null default now()
);
create index settings_log_at on projects.settings_log (at desc);
alter table projects.settings_log enable row level security;

-- ---------------------------------------------------------------------------
-- 2. The checks (the page makes the same ones: PRSettings.check in assets/pr-settings.js)
-- ---------------------------------------------------------------------------

-- '' when the value is acceptable for the key, else what is wrong
create or replace function projects.settings_check(p_key text, v jsonb)
returns text language plpgsql immutable as $$
declare
  nums constant jsonb := '{"near_words":[0,30],"max_clauses":[1,10],"keep_share":[0,100],"heading_words":[1,30],"label_chars":[10,200],
                           "figure_words":[1,40],"option_values":[1,300],"candidates_shown":[1,100],"choose_listed":[1,20]}';
  fams constant text[] := array['length','mass','areal_mass','density','u_value','pressure','flow','power','velocity','time','temperature'];
  idre constant text := '^[a-z][a-z0-9_]{0,29}$';
  e jsonb; x jsonb; i integer := 0; n numeric;
begin
  if p_key in ('near_words','max_clauses','keep_share','heading_words','label_chars','figure_words','option_values','candidates_shown','choose_listed') then
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

  return 'unknown setting';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Functions
-- ---------------------------------------------------------------------------

-- The saved settings (keys not saved use the built-in values of pr-settings.js). Anyone with the tile: the record needs them.
create or replace function public.projects_settings_get()
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare v_user core.profiles;
begin
  v_user := core.require_tile('projects', null);
  return jsonb_build_object(
    'settings', coalesce((select jsonb_agg(jsonb_build_object('key', s.key, 'value', s.value, 'updated_by_name', s.updated_by_name, 'updated_at', s.updated_at) order by s.key)
                            from projects.settings s), '[]'::jsonb),
    'can_review', core.has_tile(v_user.id, 'projects', 'review'));
end $$;
revoke execute on function public.projects_settings_get() from public, anon;
grant execute on function public.projects_settings_get() to authenticated;

-- Save several settings at once: p_values = { key: value, ... }; a value null puts the key back to the built-in value.
-- All are checked before any is saved. A value equal to the saved one is not a change. Returns what changed.
create or replace function public.projects_settings_save(p_values jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; r record; v_err text; v_old jsonb; v_changed text[] := '{}';
begin
  v_user := core.require_tile('projects', 'review');
  if p_values is null or jsonb_typeof(p_values) <> 'object' then raise exception 'INVALID:values'; end if;
  if (select count(*) from jsonb_object_keys(p_values)) not between 1 and 30 then raise exception 'INVALID:values'; end if;
  if pg_column_size(p_values) > 200000 then raise exception 'INVALID:values'; end if;
  for r in select k.key, k.value from jsonb_each(p_values) k loop
    if jsonb_typeof(r.value) = 'null' then
      if projects.settings_check(r.key, '0'::jsonb) = 'unknown setting' then raise exception 'INVALID:%', left(r.key, 40); end if;
    else
      v_err := projects.settings_check(r.key, r.value);
      if v_err <> '' then raise exception 'INVALID:%', left(r.key, 40); end if;      -- the page shows v_err's wording before it sends
    end if;
  end loop;

  for r in select k.key, k.value from jsonb_each(p_values) k order by k.key loop
    select s.value into v_old from projects.settings s where s.key = r.key for update;
    if jsonb_typeof(r.value) = 'null' then
      if v_old is null then continue; end if;
      delete from projects.settings s where s.key = r.key;
      insert into projects.settings_log (key, old_value, new_value, by_id, by_name) values (r.key, v_old, null, v_user.id, v_user.username);
    else
      if v_old is not null and v_old = r.value then continue; end if;
      insert into projects.settings as s (key, value, updated_by, updated_by_name, updated_at)
      values (r.key, r.value, v_user.id, v_user.username, now())
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = now();
      insert into projects.settings_log (key, old_value, new_value, by_id, by_name) values (r.key, v_old, r.value, v_user.id, v_user.username);
    end if;
    v_changed := v_changed || r.key;
  end loop;

  if array_length(v_changed, 1) > 0 then perform core.audit('projects', 'settings_save', jsonb_build_object('keys', to_jsonb(v_changed))); end if;
  return jsonb_build_object('changed', to_jsonb(v_changed));
end $$;
revoke execute on function public.projects_settings_save(jsonb) from public, anon;
grant execute on function public.projects_settings_save(jsonb) to authenticated;

-- What was changed, newest first (reviewers): to see who changed what and to put an earlier value back.
create or replace function public.projects_settings_history(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
begin
  perform core.require_tile('projects', 'review');
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'key', l.key, 'old', l.old_value, 'new', l.new_value, 'by', l.by_name, 'at', l.at) order by l.at desc, l.id desc)
                     from (select * from projects.settings_log order by at desc, id desc limit greatest(1, least(coalesce(p_limit, 100), 500))) l), '[]'::jsonb);
end $$;
revoke execute on function public.projects_settings_history(integer) from public, anon;
grant execute on function public.projects_settings_history(integer) to authenticated;

select core.applied('projects', '010_matching_rules');
