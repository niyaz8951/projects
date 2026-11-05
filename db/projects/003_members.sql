-- Projects tile, step 1c (sharing): a tile admin or the super user shares a project with other users of the tile,
-- who then see and work in it (list, open, edit with 'edit'); they cannot share it on. As the old tool's pr_members.
-- Replaces projects.can_open (now takes the project row), projects_list, projects_get and projects_update from 002;
-- adds projects.members, projects_share_get, projects_share_set.
-- Touches only: schema projects and functions public.projects_*. Run after 002_visibility.sql.

create table projects.members (
  project_id    uuid not null references projects.projects (id) on delete cascade,
  user_id       uuid not null,
  added_by      uuid,
  added_by_name text not null default '',
  added_at      timestamptz not null default now(),
  primary key (project_id, user_id)
);
alter table projects.members enable row level security;
create index members_user_idx on projects.members (user_id);

-- True when the caller may open the project: its creator, a member, a tile admin, or the super user
-- (core.is_tile_admin already answers true for the super user).
drop function if exists projects.can_open(core.profiles, uuid);
create or replace function projects.can_open(p_user core.profiles, p_project projects.projects)
returns boolean language sql security definer set search_path = '' stable as $$
  select p_project.created_by = p_user.id
      or core.is_tile_admin(p_user.id, 'projects')
      or exists (select 1 from projects.members m where m.project_id = p_project.id and m.user_id = p_user.id);
$$;

-- Anyone with the tile: the register, last changed first. Own and shared projects, or every project for an admin.
drop function if exists public.projects_list(text, text, text);
create or replace function public.projects_list(p_q text default null, p_region text default null, p_client_type text default null)
returns table (id uuid, code text, name text, client_type text, client_name text, region text,
               created_by_name text, created_at timestamptz, updated_at timestamptz, members integer,
               total integer, sees_all boolean)
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
           (select count(*)::integer from hit), v_all
    from hit h order by h.updated_at desc limit 300;
end $$;
revoke execute on function public.projects_list(text, text, text) from public, anon;
grant execute on function public.projects_list(text, text, text) to authenticated;

-- Anyone with the tile: one project with its members and history, if the caller may open it. Otherwise NOT_FOUND
-- (never NO_RIGHT: the answer must not tell whether the id exists). can_share says whether the caller may share it.
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
    'events', (select coalesce(jsonb_agg(jsonb_build_object('username', e.username, 'action', e.action,
                                                          'detail', e.detail, 'created_at', e.created_at)
                                         order by e.id desc), '[]'::jsonb)
               from (select * from projects.events x where x.project_id = v_p.id order by x.id desc limit 100) e));
end $$;
revoke execute on function public.projects_get(uuid) from public, anon;
grant execute on function public.projects_get(uuid) to authenticated;

-- Right 'edit', own, shared or admin: change the details. The code never changes. Every changed field is one line of history.
create or replace function public.projects_update(p_id uuid, p_name text, p_client_type text, p_client_name text, p_region text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_old projects.projects; v_changes text[] := '{}';
begin
  v_user := core.require_tile('projects', 'edit');
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

-- Tile admin or super user: who the project is shared with, and the people it can be shared with
-- (active users of the tile other than the creator and the caller). A plain user gets NOT_FOUND for a project he cannot open and
-- NO_RIGHT for one he can. The list of people comes from core.tile_users('projects') (docs/CORE-REQUESTS.md);
-- until the core has it, 'users' is empty and 'core_missing' is true, and members can only be removed.
create or replace function public.projects_share_get(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_p projects.projects; v_users jsonb := '[]'::jsonb; v_missing boolean := false;
begin
  v_user := core.require_tile('projects', null);
  select * into v_p from projects.projects p where p.id = p_id;
  if not found or not projects.can_open(v_user, v_p) then raise exception 'NOT_FOUND'; end if;
  if not core.is_tile_admin(v_user.id, 'projects') then raise exception 'NO_RIGHT'; end if;
  if to_regprocedure('core.tile_users(text)') is null then
    v_missing := true;
  else
    execute 'select coalesce(jsonb_agg(jsonb_build_object(''id'', u.id, ''username'', u.username, ''display_name'', u.display_name)'
         || ' order by u.username), ''[]''::jsonb) from core.tile_users(''projects'') u where u.id <> $1 and u.id <> $2'
      into v_users using v_p.created_by, v_user.id;
  end if;
  return jsonb_build_object(
    'created_by_name', v_p.created_by_name,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'username', d.username, 'display_name', d.display_name,
                                                           'active', d.active) order by d.username), '[]'::jsonb)
                from core.display_names('projects', (select array_agg(m.user_id) from projects.members m where m.project_id = v_p.id)) d),
    'users', v_users, 'core_missing', v_missing);
end $$;
revoke execute on function public.projects_share_get(uuid) from public, anon;
grant execute on function public.projects_share_get(uuid) to authenticated;

-- Tile admin or super user: set the whole list of people the project is shared with. Every id must be an active user
-- with the tile (INVALID:user_ids otherwise); the creator is never a member. Adds and removals go to History.
create or replace function public.projects_share_set(p_id uuid, p_user_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_p projects.projects; v_ids uuid[]; v_added uuid[]; v_removed uuid[]; v_names text;
begin
  v_user := core.require_tile('projects', null);
  select * into v_p from projects.projects p where p.id = p_id;
  if not found or not projects.can_open(v_user, v_p) then raise exception 'NOT_FOUND'; end if;
  if not core.is_tile_admin(v_user.id, 'projects') then raise exception 'NO_RIGHT'; end if;
  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_ids
    from unnest(coalesce(p_user_ids, '{}'::uuid[])) x where x is not null and x <> v_p.created_by;
  if cardinality(v_ids) > 200 then raise exception 'INVALID:user_ids'; end if;
  if exists (select 1 from unnest(v_ids) x where not core.has_tile(x, 'projects', null)) then raise exception 'INVALID:user_ids'; end if;

  select coalesce(array_agg(x), '{}'::uuid[]) into v_added
    from unnest(v_ids) x where not exists (select 1 from projects.members m where m.project_id = v_p.id and m.user_id = x);
  select coalesce(array_agg(m.user_id), '{}'::uuid[]) into v_removed
    from projects.members m where m.project_id = v_p.id and m.user_id <> all (v_ids);

  if cardinality(v_removed) > 0 then
    delete from projects.members m where m.project_id = v_p.id and m.user_id = any (v_removed);
    select string_agg('@' || d.username, ', ' order by d.username) into v_names from core.display_names('projects', v_removed) d;
    insert into projects.events (project_id, user_id, username, action, detail)
    values (v_p.id, v_user.id, v_user.username, 'sharing ended for', left(coalesce(v_names, ''), 400));
  end if;
  if cardinality(v_added) > 0 then
    insert into projects.members (project_id, user_id, added_by, added_by_name)
    select v_p.id, x, v_user.id, v_user.username from unnest(v_added) x;
    select string_agg('@' || d.username, ', ' order by d.username) into v_names from core.display_names('projects', v_added) d;
    insert into projects.events (project_id, user_id, username, action, detail)
    values (v_p.id, v_user.id, v_user.username, 'shared with', left(coalesce(v_names, ''), 400));
  end if;
  if cardinality(v_added) > 0 or cardinality(v_removed) > 0 then
    update projects.projects set updated_by = v_user.id, updated_by_name = v_user.username, updated_at = now() where id = v_p.id;
    perform core.audit('projects', 'project_share', jsonb_build_object('id', v_p.id, 'added', cardinality(v_added), 'removed', cardinality(v_removed)));
  end if;
  return jsonb_build_object('members', cardinality(v_ids), 'added', cardinality(v_added), 'removed', cardinality(v_removed));
end $$;
revoke execute on function public.projects_share_set(uuid, uuid[]) from public, anon;
grant execute on function public.projects_share_set(uuid, uuid[]) to authenticated;

select core.applied('projects', '003_members');
