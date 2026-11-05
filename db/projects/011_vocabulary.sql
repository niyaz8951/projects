-- Projects tile: the vocabulary (owner, 2026-11-05: "these matching rules can better match using what we had done for
-- vocabulary in maps, same sort of application for this button" - "yes go ahead").
-- The old tool's vocabulary map, as data of this tile (no map, no AI): per product, the standards specifications cite,
-- the components of the unit and under each component the requirement types (kind, terms, anchors, unit, direction,
-- scale, standards, options, Not words, the datasheet row that answers it, equivalents, an example). The browser
-- (assets/pr-vocab.js, a port of the old vocab.ts identify()) recognises what a clause asks by these landmarks.
-- A product is matched by the vocabulary only when a reviewer switches it on (setting 'vocab_products'); a datasheet
-- row no verified type points at is still found by its Spec keywords. Nothing imported is read before a reviewer
-- verifies it. Edited on the Matching rules page (right 'review'); read by anyone with the tile (the record needs it).
-- Touches only: schema projects and functions public.projects_*. Run after 010_matching_rules.sql.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create table projects.vocab (
  id              uuid primary key default gen_random_uuid(),
  product_id      text not null references projects.products (id) on delete cascade,
  level           text not null check (level in ('standard', 'component', 'type')),
  component       text not null default '' check (char_length(component) <= 80),     -- a type's component; a component's own title
  title           text not null check (char_length(title) between 1 and 120),
  note            text not null default '' check (char_length(note) <= 2000),
  fields          jsonb not null default '{}',
  verified        boolean not null default false,
  sort_order      integer not null default 0,
  updated_by      uuid,
  updated_by_name text not null default '',
  updated_at      timestamptz not null default now()
);
create unique index vocab_name on projects.vocab (product_id, level, lower(component), lower(title));
create index vocab_product on projects.vocab (product_id, sort_order);
alter table projects.vocab enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Checks
-- ---------------------------------------------------------------------------

-- '' when an item is acceptable, else what is wrong (the page checks the same: PRVocab.checkItem)
create or replace function projects.vocab_check(p jsonb)
returns text language plpgsql immutable as $$
declare f jsonb; k text; lv text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'an item'; end if;
  lv := p ->> 'level';
  if lv is null or lv not in ('standard', 'component', 'type') then return 'level'; end if;
  if jsonb_typeof(p -> 'title') <> 'string' or char_length(trim(p ->> 'title')) not between 1 and 120 then return 'title'; end if;
  if p ? 'component' and (jsonb_typeof(p -> 'component') <> 'string' or char_length(p ->> 'component') > 80) then return 'component'; end if;
  if lv = 'type' and char_length(trim(coalesce(p ->> 'component', ''))) = 0 then return 'component'; end if;
  if p ? 'note' and (jsonb_typeof(p -> 'note') <> 'string' or char_length(p ->> 'note') > 2000) then return 'note'; end if;
  f := coalesce(p -> 'fields', '{}'::jsonb);
  if jsonb_typeof(f) <> 'object' then return 'fields'; end if;
  for k in select jsonb_object_keys(f) loop
    if k not in ('kind', 'terms', 'anchors', 'unit', 'dir', 'scale', 'standards', 'options', 'not', 'rows', 'equivalents', 'example') then return 'field ' || left(k, 20); end if;
    if k in ('terms', 'anchors', 'scale', 'standards', 'options', 'not', 'rows', 'equivalents') then
      if jsonb_typeof(f -> k) <> 'array' or jsonb_array_length(f -> k) > 60
         or exists (select 1 from jsonb_array_elements(f -> k) e where jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') not between 1 and 200) then
        return k;
      end if;
    end if;
  end loop;
  if f ? 'unit' and (jsonb_typeof(f -> 'unit') <> 'string' or (f ->> 'unit') !~ '^[a-z0-9/%.()²³µ]{0,20}$') then return 'unit'; end if;
  if f ? 'dir' and coalesce(f ->> 'dir', '') not in ('', 'higher', 'lower', 'exact') then return 'dir'; end if;
  if f ? 'example' and (jsonb_typeof(f -> 'example') <> 'string' or char_length(f ->> 'example') > 600) then return 'example'; end if;
  if lv = 'type' then
    if coalesce(f ->> 'kind', '') not in ('value', 'class', 'standard', 'choice', 'presence') then return 'kind'; end if;
  elsif f ? 'kind' then return 'kind';
  end if;
  return '';
end $$;

-- the settings check, with the switch of 011 (otherwise as 010)
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

  return 'unknown setting';
end $$;


-- ---------------------------------------------------------------------------
-- 3. Functions
-- ---------------------------------------------------------------------------

-- The vocabulary of a product. Anyone with the tile: the verified items (the record matches with them); a reviewer
-- gets every item, verified or not, to edit them.
create or replace function public.projects_vocab_get(p_product_id text)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare v_user core.profiles; v_prod projects.products; v_rev boolean;
begin
  v_user := core.require_tile('projects', null);
  v_prod := projects.product(p_product_id);
  v_rev := core.has_tile(v_user.id, 'projects', 'review');
  return jsonb_build_object('product_id', v_prod.id, 'can_review', v_rev,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'level', x.level, 'component', x.component, 'title', x.title, 'note', x.note,
                                 'fields', x.fields, 'verified', x.verified, 'sort', x.sort_order, 'by', x.updated_by_name, 'at', x.updated_at)
                               order by x.sort_order, x.level, x.component, x.title)
                        from projects.vocab x where x.product_id = v_prod.id and (v_rev or x.verified)), '[]'::jsonb));
end $$;
revoke execute on function public.projects_vocab_get(text) from public, anon;
grant execute on function public.projects_vocab_get(text) to authenticated;

-- One item added (no id) or changed (its id). A changed item keeps its verified mark unless p_item says otherwise.
-- A component renamed takes its types with it. Returns { id }.
create or replace function public.projects_vocab_save(p_product_id text, p_item jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_prod projects.products; v_old projects.vocab; v_id uuid; v_err text; v_level text; v_comp text; v_title text;
begin
  v_user := core.require_tile('projects', 'review');
  v_prod := projects.product(p_product_id);
  v_err := projects.vocab_check(p_item);
  if v_err <> '' then raise exception 'INVALID:%', v_err; end if;
  v_level := p_item ->> 'level'; v_title := trim(p_item ->> 'title');
  v_comp := case when v_level = 'component' then v_title when v_level = 'standard' then '' else trim(p_item ->> 'component') end;
  if jsonb_typeof(p_item -> 'id') = 'string' then
    if (p_item ->> 'id') !~ '^[0-9a-f-]{36}$' then raise exception 'INVALID:id'; end if;
    select * into v_old from projects.vocab x where x.id = (p_item ->> 'id')::uuid and x.product_id = v_prod.id for update;
    if v_old.id is null then raise exception 'NOT_FOUND'; end if;
    if v_old.level <> v_level then raise exception 'INVALID:level'; end if;
  end if;
  if v_level = 'type' and not exists (select 1 from projects.vocab c where c.product_id = v_prod.id and c.level = 'component' and lower(c.title) = lower(v_comp)) then
    raise exception 'INVALID:component';
  end if;
  if exists (select 1 from projects.vocab x where x.product_id = v_prod.id and x.level = v_level and lower(x.component) = lower(v_comp)
                and lower(x.title) = lower(v_title) and x.id is distinct from v_old.id) then
    raise exception 'INVALID:duplicate';
  end if;
  if v_old.id is null then
    insert into projects.vocab (product_id, level, component, title, note, fields, verified, sort_order, updated_by, updated_by_name)
    values (v_prod.id, v_level, v_comp, v_title, coalesce(p_item ->> 'note', ''), coalesce(p_item -> 'fields', '{}'::jsonb),
            coalesce((p_item ->> 'verified')::boolean, false),
            coalesce((p_item ->> 'sort')::integer, (select coalesce(max(x.sort_order), 0) + 1 from projects.vocab x where x.product_id = v_prod.id)),
            v_user.id, v_user.username)
    returning id into v_id;
  else
    update projects.vocab x set component = v_comp, title = v_title, note = coalesce(p_item ->> 'note', ''), fields = coalesce(p_item -> 'fields', '{}'::jsonb),
           verified = coalesce((p_item ->> 'verified')::boolean, x.verified), updated_by = v_user.id, updated_by_name = v_user.username, updated_at = now()
     where x.id = v_old.id;
    v_id := v_old.id;
    if v_level = 'component' and lower(v_old.title) <> lower(v_title) then
      update projects.vocab x set component = v_title where x.product_id = v_prod.id and x.level = 'type' and lower(x.component) = lower(v_old.title);
    end if;
  end if;
  perform core.audit('projects', 'vocab_save', jsonb_build_object('product', v_prod.id, 'id', v_id, 'level', v_level));
  return jsonb_build_object('id', v_id);
end $$;
revoke execute on function public.projects_vocab_save(text, jsonb) from public, anon;
grant execute on function public.projects_vocab_save(text, jsonb) to authenticated;

-- Many items at once (the starter vocabulary, an outline): every item is checked first; with p_replace the product's
-- vocabulary is emptied first, otherwise an item with the same level, component and title is replaced and the others
-- are added. Everything imported waits to be verified. At most 2000 items. Returns { added, updated, removed }.
create or replace function public.projects_vocab_import(p_product_id text, p_items jsonb, p_replace boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_prod projects.products; v_removed integer := 0; v_added integer := 0; v_updated integer := 0; r record; v_id uuid; v_comp text; v_seq integer;
begin
  v_user := core.require_tile('projects', 'review');
  v_prod := projects.product(p_product_id);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 2000 then raise exception 'INVALID:items'; end if;
  if pg_column_size(p_items) > 3000000 then raise exception 'INVALID:items'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) e where projects.vocab_check(e.value) <> '') then raise exception 'INVALID:items'; end if;
  -- the same item twice in one import, or a type whose component the import does not bring and the vocabulary lacks
  if (select count(*) from (select distinct e.value ->> 'level', lower(case when e.value ->> 'level' = 'component' then trim(e.value ->> 'title') when e.value ->> 'level' = 'standard' then '' else trim(e.value ->> 'component') end), lower(trim(e.value ->> 'title'))
                              from jsonb_array_elements(p_items) e) d) <> jsonb_array_length(p_items) then raise exception 'INVALID:duplicate'; end if;
  if p_replace then
    with gone as (delete from projects.vocab x where x.product_id = v_prod.id returning 1) select count(*) into v_removed from gone;
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e where e.value ->> 'level' = 'type'
                and not exists (select 1 from jsonb_array_elements(p_items) c where c.value ->> 'level' = 'component' and lower(trim(c.value ->> 'title')) = lower(trim(e.value ->> 'component')))
                and not exists (select 1 from projects.vocab c where c.product_id = v_prod.id and c.level = 'component' and lower(c.title) = lower(trim(e.value ->> 'component')))) then
    raise exception 'INVALID:component';
  end if;
  select coalesce(max(x.sort_order), 0) into v_seq from projects.vocab x where x.product_id = v_prod.id;
  for r in select e.value as it, e.ordinality as ord from jsonb_array_elements(p_items) with ordinality e loop
    v_comp := case when r.it ->> 'level' = 'component' then trim(r.it ->> 'title') when r.it ->> 'level' = 'standard' then '' else trim(r.it ->> 'component') end;
    select x.id into v_id from projects.vocab x where x.product_id = v_prod.id and x.level = r.it ->> 'level' and lower(x.component) = lower(v_comp) and lower(x.title) = lower(trim(r.it ->> 'title'));
    if v_id is null then
      insert into projects.vocab (product_id, level, component, title, note, fields, verified, sort_order, updated_by, updated_by_name)
      values (v_prod.id, r.it ->> 'level', v_comp, trim(r.it ->> 'title'), coalesce(r.it ->> 'note', ''), coalesce(r.it -> 'fields', '{}'::jsonb), false, v_seq + r.ord::integer, v_user.id, v_user.username);
      v_added := v_added + 1;
    else
      update projects.vocab x set note = coalesce(r.it ->> 'note', ''), fields = coalesce(r.it -> 'fields', '{}'::jsonb), verified = false,
             updated_by = v_user.id, updated_by_name = v_user.username, updated_at = now() where x.id = v_id;
      v_updated := v_updated + 1;
    end if;
  end loop;
  perform core.audit('projects', 'vocab_import', jsonb_build_object('product', v_prod.id, 'added', v_added, 'updated', v_updated, 'removed', v_removed));
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'removed', v_removed);
end $$;
revoke execute on function public.projects_vocab_import(text, jsonb, boolean) from public, anon;
grant execute on function public.projects_vocab_import(text, jsonb, boolean) to authenticated;

-- Verify (or take back to verify) some items (p_ids, a list of ids) or every item of the product (p_ids null).
create or replace function public.projects_vocab_verify(p_product_id text, p_ids jsonb, p_verified boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_prod projects.products; v_n integer;
begin
  v_user := core.require_tile('projects', 'review');
  v_prod := projects.product(p_product_id);
  if p_verified is null then raise exception 'INVALID:verified'; end if;
  if p_ids is not null and (jsonb_typeof(p_ids) <> 'array' or jsonb_array_length(p_ids) > 2000
     or exists (select 1 from jsonb_array_elements(p_ids) e where jsonb_typeof(e.value) <> 'string' or (e.value #>> '{}') !~ '^[0-9a-f-]{36}$')) then
    raise exception 'INVALID:ids';
  end if;
  with ch as (
    update projects.vocab x set verified = p_verified, updated_by = v_user.id, updated_by_name = v_user.username, updated_at = now()
     where x.product_id = v_prod.id and x.verified <> p_verified
       and (p_ids is null or x.id in (select (e.value #>> '{}')::uuid from jsonb_array_elements(p_ids) e))
    returning 1)
  select count(*) into v_n from ch;
  if v_n > 0 then perform core.audit('projects', 'vocab_verify', jsonb_build_object('product', v_prod.id, 'n', v_n, 'verified', p_verified)); end if;
  return jsonb_build_object('changed', v_n);
end $$;
revoke execute on function public.projects_vocab_verify(text, jsonb, boolean) from public, anon;
grant execute on function public.projects_vocab_verify(text, jsonb, boolean) to authenticated;

-- Remove items; a component takes its types with it.
create or replace function public.projects_vocab_delete(p_product_id text, p_ids jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_prod projects.products; v_n integer;
begin
  v_user := core.require_tile('projects', 'review');
  v_prod := projects.product(p_product_id);
  if p_ids is null or jsonb_typeof(p_ids) <> 'array' or jsonb_array_length(p_ids) not between 1 and 2000
     or exists (select 1 from jsonb_array_elements(p_ids) e where jsonb_typeof(e.value) <> 'string' or (e.value #>> '{}') !~ '^[0-9a-f-]{36}$') then
    raise exception 'INVALID:ids';
  end if;
  with picked as (select x.* from projects.vocab x where x.product_id = v_prod.id and x.id in (select (e.value #>> '{}')::uuid from jsonb_array_elements(p_ids) e)),
       gone as (delete from projects.vocab x where x.product_id = v_prod.id
                  and (x.id in (select id from picked)
                       or (x.level = 'type' and lower(x.component) in (select lower(p.title) from picked p where p.level = 'component')))
                returning 1)
  select count(*) into v_n from gone;
  if v_n > 0 then perform core.audit('projects', 'vocab_delete', jsonb_build_object('product', v_prod.id, 'n', v_n)); end if;
  return jsonb_build_object('removed', v_n);
end $$;
revoke execute on function public.projects_vocab_delete(text, jsonb) from public, anon;
grant execute on function public.projects_vocab_delete(text, jsonb) to authenticated;

select core.applied('projects', '011_vocabulary');
