-- Projects tile, step 1 (project register): schema projects, three tables, five functions.
-- Touches only: schema projects and functions public.projects_*. No bucket yet: nothing uploads in step 1;
-- the bucket 'projects' and its policies come with the first step that stores files.
-- Register the tile 'projects' in the admin page first (the security check wants a registered prefix).

create schema if not exists projects;
revoke all on schema projects from public, anon, authenticated;
alter default privileges in schema projects revoke execute on functions from public;

-- Pick lists shown in the create form. Values are generic (countries, kinds of client), never a customer.
create table projects.lists (
  kind       text not null check (kind in ('client_type', 'region')),
  value      text not null check (char_length(value) between 1 and 60),
  sort_order integer not null default 100,
  primary key (kind, value)
);
alter table projects.lists enable row level security;

insert into projects.lists (kind, value, sort_order) values
  ('client_type', 'Consultant', 10), ('client_type', 'Contractor', 20), ('client_type', 'Developer / Owner', 30),
  ('client_type', 'Distributor / Dealer', 40), ('client_type', 'Government', 50), ('client_type', 'Other', 90),
  ('region', 'UAE', 10), ('region', 'Saudi Arabia', 20), ('region', 'Qatar', 30), ('region', 'Kuwait', 40),
  ('region', 'Bahrain', 50), ('region', 'Oman', 60), ('region', 'Egypt', 70), ('region', 'Other Middle East', 80),
  ('region', 'Africa', 85), ('region', 'Other', 90);

-- One counter per name, only goes up. Used for project codes, which are never reused.
create table projects.counters (
  name  text primary key,
  value integer not null default 0
);
alter table projects.counters enable row level security;
insert into projects.counters (name, value) values ('project', 0);

-- The register. Usernames are kept next to the ids so a list never needs a join into core.
create table projects.projects (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique check (code ~ '^P-[0-9]{4}-[0-9]{4,}$'),
  name            text not null check (char_length(name) between 1 and 120),
  client_type     text not null check (char_length(client_type) between 1 and 60),
  client_name     text not null check (char_length(client_name) between 1 and 120),
  region          text not null check (char_length(region) between 1 and 60),
  created_by      uuid not null,
  created_by_name text not null,
  created_at      timestamptz not null default now(),
  updated_by      uuid not null,
  updated_by_name text not null,
  updated_at      timestamptz not null default now()
);
alter table projects.projects enable row level security;
create index projects_updated_idx on projects.projects (updated_at desc);
create index projects_name_idx on projects.projects (lower(name));

-- What happened inside a project, shown on its page as History.
create table projects.events (
  id         bigint generated always as identity primary key,
  project_id uuid not null references projects.projects (id) on delete cascade,
  user_id    uuid not null,
  username   text not null,
  action     text not null check (char_length(action) between 1 and 40),
  detail     text not null default '' check (char_length(detail) <= 400),
  created_at timestamptz not null default now()
);
alter table projects.events enable row level security;
create index events_project_idx on projects.events (project_id, id desc);

-- Checks shared by create and update. Raises INVALID:<field>.
create or replace function projects.check_fields(p_name text, p_client_type text, p_client_name text, p_region text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 120 then raise exception 'INVALID:name'; end if;
  if char_length(trim(coalesce(p_client_name, ''))) not between 1 and 120 then raise exception 'INVALID:client_name'; end if;
  if not exists (select 1 from projects.lists l where l.kind = 'client_type' and l.value = p_client_type) then
    raise exception 'INVALID:client_type';
  end if;
  if not exists (select 1 from projects.lists l where l.kind = 'region' and l.value = p_region) then
    raise exception 'INVALID:region';
  end if;
end $$;

-- Anyone with the tile: the pick lists for the create form and the filters.
create or replace function public.projects_lists()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_tile('projects', null);
  return jsonb_build_object(
    'client_types', (select coalesce(jsonb_agg(l.value order by l.sort_order, l.value), '[]'::jsonb)
                     from projects.lists l where l.kind = 'client_type'),
    'regions',      (select coalesce(jsonb_agg(l.value order by l.sort_order, l.value), '[]'::jsonb)
                     from projects.lists l where l.kind = 'region'));
end $$;
revoke execute on function public.projects_lists() from public, anon;
grant execute on function public.projects_lists() to authenticated;

-- Anyone with the tile: the register, last changed first. p_q matches code, name or client; empty filters mean all.
create or replace function public.projects_list(p_q text default null, p_region text default null, p_client_type text default null)
returns table (id uuid, code text, name text, client_type text, client_name text, region text,
               created_by_name text, created_at timestamptz, updated_at timestamptz, total integer)
language plpgsql security definer set search_path = '' as $$
declare v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  perform core.require_tile('projects', null);
  if char_length(coalesce(v_q, '')) > 120 then raise exception 'INVALID:q'; end if;
  return query
    with hit as (
      select p.* from projects.projects p
      where (p_region is null or p_region = '' or p.region = p_region)
        and (p_client_type is null or p_client_type = '' or p.client_type = p_client_type)
        and (v_q is null or p.name ilike '%' || v_q || '%' or p.client_name ilike '%' || v_q || '%' or p.code ilike '%' || v_q || '%')
    )
    select h.id, h.code, h.name, h.client_type, h.client_name, h.region,
           h.created_by_name, h.created_at, h.updated_at, (select count(*)::integer from hit)
    from hit h order by h.updated_at desc limit 300;
end $$;
revoke execute on function public.projects_list(text, text, text) from public, anon;
grant execute on function public.projects_list(text, text, text) to authenticated;

-- Right 'edit': create a project. The code is P-<year>-<number>, the number from a counter that only goes up.
create or replace function public.projects_create(p_name text, p_client_type text, p_client_name text, p_region text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_id uuid; v_n integer; v_code text;
begin
  v_user := core.require_tile('projects', 'edit');
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

-- Anyone with the tile: one project with its history (newest first, last 100).
create or replace function public.projects_get(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_p projects.projects;
begin
  perform core.require_tile('projects', null);
  select * into v_p from projects.projects p where p.id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object(
    'id', v_p.id, 'code', v_p.code, 'name', v_p.name, 'client_type', v_p.client_type,
    'client_name', v_p.client_name, 'region', v_p.region,
    'created_by_name', v_p.created_by_name, 'created_at', v_p.created_at,
    'updated_by_name', v_p.updated_by_name, 'updated_at', v_p.updated_at,
    'events', (select coalesce(jsonb_agg(jsonb_build_object('username', e.username, 'action', e.action,
                                                          'detail', e.detail, 'created_at', e.created_at)
                                         order by e.id desc), '[]'::jsonb)
               from (select * from projects.events x where x.project_id = v_p.id order by x.id desc limit 100) e));
end $$;
revoke execute on function public.projects_get(uuid) from public, anon;
grant execute on function public.projects_get(uuid) to authenticated;

-- Right 'edit': change the details of a project. The code never changes. Every changed field is one line of history.
create or replace function public.projects_update(p_id uuid, p_name text, p_client_type text, p_client_name text, p_region text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_old projects.projects; v_changes text[] := '{}';
begin
  v_user := core.require_tile('projects', 'edit');
  perform projects.check_fields(p_name, p_client_type, p_client_name, p_region);
  select * into v_old from projects.projects p where p.id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
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

select core.applied('projects', '001_init');
