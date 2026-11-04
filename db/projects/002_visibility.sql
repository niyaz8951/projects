-- Projects tile, step 1b (visibility): a user sees and edits his own projects; a tile admin and the super user see
-- and edit every project. Replaces projects_list, projects_get and projects_update from 001; adds projects.can_open.
-- Touches only: schema projects and functions public.projects_*. Run after 001_init.sql.

-- True when the caller may open the project: its creator, a tile admin, or the super user
-- (core.is_tile_admin already answers true for the super user).
create or replace function projects.can_open(p_user core.profiles, p_created_by uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select p_created_by = p_user.id or core.is_tile_admin(p_user.id, 'projects');
$$;

-- Anyone with the tile: the register, last changed first. Own projects, or every project for an admin.
-- The page also gets 'mine' per row and the caller's view in 'sees_all' so it can hide the "Created by" column.
drop function if exists public.projects_list(text, text, text);
create or replace function public.projects_list(p_q text default null, p_region text default null, p_client_type text default null)
returns table (id uuid, code text, name text, client_type text, client_name text, region text,
               created_by_name text, created_at timestamptz, updated_at timestamptz, total integer, sees_all boolean)
language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_all boolean; v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  v_user := core.require_tile('projects', null);
  v_all := core.is_tile_admin(v_user.id, 'projects');
  if char_length(coalesce(v_q, '')) > 120 then raise exception 'INVALID:q'; end if;
  return query
    with hit as (
      select p.* from projects.projects p
      where (v_all or p.created_by = v_user.id)
        and (p_region is null or p_region = '' or p.region = p_region)
        and (p_client_type is null or p_client_type = '' or p.client_type = p_client_type)
        and (v_q is null or p.name ilike '%' || v_q || '%' or p.client_name ilike '%' || v_q || '%' or p.code ilike '%' || v_q || '%')
    )
    select h.id, h.code, h.name, h.client_type, h.client_name, h.region,
           h.created_by_name, h.created_at, h.updated_at, (select count(*)::integer from hit), v_all
    from hit h order by h.updated_at desc limit 300;
end $$;
revoke execute on function public.projects_list(text, text, text) from public, anon;
grant execute on function public.projects_list(text, text, text) to authenticated;

-- Anyone with the tile: one project with its history, if the caller may open it. Otherwise NOT_FOUND
-- (never NO_RIGHT: the answer must not tell whether the id exists).
create or replace function public.projects_get(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_p projects.projects;
begin
  v_user := core.require_tile('projects', null);
  select * into v_p from projects.projects p where p.id = p_id;
  if not found or not projects.can_open(v_user, v_p.created_by) then raise exception 'NOT_FOUND'; end if;
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

-- Right 'edit', own project or admin: change the details. The code never changes. Every changed field is one line of history.
create or replace function public.projects_update(p_id uuid, p_name text, p_client_type text, p_client_name text, p_region text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_old projects.projects; v_changes text[] := '{}';
begin
  v_user := core.require_tile('projects', 'edit');
  perform projects.check_fields(p_name, p_client_type, p_client_name, p_region);
  select * into v_old from projects.projects p where p.id = p_id;
  if not found or not projects.can_open(v_user, v_old.created_by) then raise exception 'NOT_FOUND'; end if;
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

select core.applied('projects', '002_visibility');
