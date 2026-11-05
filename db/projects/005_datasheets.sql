-- Projects tile, step 2 (Datasheet notes): the tables read from datasheets, the row mapping with its starter keywords,
-- and the Product Options values collected from every datasheet read. Rewritten from the old tool's routes
-- pr_note_save / pr_note_get / pr_delete_record (worker/src/api/pr.ts), dn_get_rules / dn_add_rows (dn.ts) and
-- po_collect (po.ts) as Postgres functions, with the same checks. The datasheet PDF is never stored: only the table.
-- Also replaces projects_list and projects_get (they now carry the project's datasheet tables).
-- Touches only: schema projects and functions public.projects_*. Run after 004_products_factories.sql.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- One table read from a datasheet, kept in the project (the old pr_notes + its R2 JSON). columns = the unit tags,
-- rows = [{ section, component, cells, marks, kind, key }] as DSParse.grid builds them.
create table projects.notes (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects.projects (id) on delete cascade,
  user_id     uuid not null,
  username    text not null,
  product_id  text not null references projects.products (id),
  factory_id  text not null default '',          -- the factory the datasheet names (Material Name); '' when unknown or mixed
  file_names  text not null default '' check (char_length(file_names) <= 400),
  units       integer not null default 0,
  row_count   integer not null default 0,
  columns     jsonb not null default '[]'::jsonb,
  rows        jsonb not null default '[]'::jsonb,
  bytes       integer not null default 0,
  created_at  timestamptz not null default now()
);
alter table projects.notes enable row level security;
create index notes_project_idx on projects.notes (project_id, created_at desc);

-- The row mapping, one list per product for every factory and every user (the old dn_map): which datasheet rows are
-- shown, what they are called, what to remove from the value, the standard response, and the keywords that link a
-- specification clause to the row (step 3). A row arrives with the first datasheet that holds it.
create table projects.dn_map (
  product_id text not null references projects.products (id) on delete cascade,
  row_key    text not null check (char_length(row_key) between 1 and 300),
  section    text not null default '' check (char_length(section) <= 200),
  sub        text not null default '' check (char_length(sub) <= 200),
  component  text not null default '' check (char_length(component) <= 200),
  show       boolean not null default true,
  label      text not null default '' check (char_length(label) <= 120),
  strip      text not null default '' check (char_length(strip) <= 300),
  response   text not null default '' check (char_length(response) <= 1000),
  keywords   text not null default '' check (char_length(keywords) <= 600),
  sort_order integer not null default 0,
  reviewed   boolean not null default true,     -- false = "New" on the mapping page until an editor saves it
  in_tree    boolean not null default true,     -- false = left out of Product Options
  kind       text not null default '' check (kind in ('', 'option', 'duty')),
  place      text not null default '' check (place in ('', 'general', 'model')),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (product_id, row_key)
);
alter table projects.dn_map enable row level security;

create table projects.dn_map_settings (
  product_id    text primary key references projects.products (id) on delete cascade,
  show_unmapped boolean not null default true,  -- rows not in the list yet are shown (true) or left out
  updated_by    uuid,
  updated_at    timestamptz not null default now()
);
alter table projects.dn_map_settings enable row level security;

-- Starter keywords and "Remove text" per product (the old dn_starter_keywords after migrations 0005 and 0013):
-- configuration, no internal data. A row new to the mapping gets them.
create table projects.dn_starter_keywords (
  product_id text not null references projects.products (id) on delete cascade,
  row_key    text not null,
  keywords   text not null,
  strip      text not null default '',
  primary key (product_id, row_key)
);
alter table projects.dn_starter_keywords enable row level security;
insert into projects.dn_starter_keywords (product_id, row_key, keywords, strip) values
  ('ahu', 'general||power supply', 'power supply; electrical characteristic; electrical supply; supply voltage; main power; electrical power', '+ PE'),
  ('ahu', 'unit data||panel', 'double wall; double skin; panel thick; casing thick; wall thick; panel construction', ''),
  ('ahu', 'unit data||insulation', 'insulation; insulated panel; mineral wool; rockwool; polyurethane; injected foam; thermal conductance', ''),
  ('ahu', 'unit data||panel inner skin', 'inner panel; inside casing; inner skin; inner sheet; interior panel', ''),
  ('ahu', 'unit data||panel outer skin', 'outer panel; outside casing; outer skin; outer sheet; exterior panel', ''),
  ('ahu', 'unit data||profile', 'thermal break; frame profile; aluminium profile; aluminum profile; casing frame', ''),
  ('ahu', 'unit data||ahu base', 'base rail; base frame; steel base; channel base; mounting frame; unit base; skid', ''),
  ('ahu', 'unit data||roof', 'outdoor installation; outdoor unit; weatherproof; weather proof; weather resistant; rain hood; canopy; roof curb', ''),
  ('ahu', 'unit data||door', 'access side; door side; handing', ''),
  ('ahu', 'unit data||supply air flow', 'design air flow; supply air flow; supply airflow; air flow rate; air quantity', ''),
  ('ahu', 'unit data||external pressure drop', 'external static; external pressure', ''),
  ('ahu', 'unit data||sfpv (clean filters)', 'specific fan power; sfp', ''),
  ('ahu', 'unit data||erp compliant', 'erp; ecodesign', ''),
  ('ahu', 'mixing box supply||drain pan', 'drain pan', ''),
  ('ahu', 'mixing box supply|damper one supply|material', 'damper blade; damper galvan; damper alumin; blade damper; damper frame', ''),
  ('ahu', 'filter supply||filter class', 'filter efficien; filter class; panel filter; bag filter; hepa; extended surface; dust spot; merv; arrestance; iso 16890', ''),
  ('ahu', 'filter supply||material', 'filter media; media material', ''),
  ('ahu', 'filter supply||dirty pressure drop', 'final resistance; dirty filter; final pressure drop; filter pressure drop', ''),
  ('ahu', 'coil cooling dx supply|geometry|rows', 'rows deep; coil rows; row coil', ''),
  ('ahu', 'coil cooling dx supply|geometry|frame', 'coil frame; coil casing; channel frame', ''),
  ('ahu', 'coil cooling dx supply|geometry|tube material', 'copper tube; tube material; seamless copper', ''),
  ('ahu', 'coil cooling dx supply|geometry|tube thickness', 'tube wall thick; tube thick', ''),
  ('ahu', 'coil cooling dx supply|geometry|fin material', 'fin alumin; fin copper; fin material; fin coated', ''),
  ('ahu', 'coil cooling dx supply|geometry|fin space', 'fins per; fin spac; fpi', ''),
  ('ahu', 'coil cooling dx supply|geometry|air velocity', 'face velocity', ''),
  ('ahu', 'coil cooling dx supply|geometry|drain pan', 'drain pan', ''),
  ('ahu', 'coil cooling dx supply|cooling|total capacity', 'cooling capacity; total capacity', ''),
  ('ahu', 'fan supply||type', 'centrifugal fan; plug fan; plenum fan; ec fan; backward curved; forward curved; fan type', ''),
  ('ahu', 'fan supply||efficiency', 'fan efficien; static efficien', ''),
  ('ahu', 'fan supply|motor data|efficiency class', 'motor efficien; ie2; ie3; ie4; ie5; premium efficien', ''),
  ('ahu', 'fan supply|motor data|electrical connection', 'motor volt; motor phase', ''),
  ('ahu', 'filter supply||dimensions', 'thickness; filter depth; filter size; bag length; pocket length; deep cells', ''),
  ('ahu', 'filter supply||clean pressure drop', 'initial resistance; clean filter; initial pressure drop', ''),
  ('ahu', 'filter supply||air velocity', 'filter face velocity; face velocity', ''),
  ('ahu', 'coil cooling water supply|geometry|rows', 'rows deep; coil rows; row coil; number of rows', ''),
  ('ahu', 'coil cooling water supply|geometry|frame', 'coil frame; coil casing; channel frame', ''),
  ('ahu', 'coil cooling water supply|geometry|tube material', 'copper tube; tube material; seamless copper', ''),
  ('ahu', 'coil cooling water supply|geometry|tube thickness', 'tube wall thick; tube thick', ''),
  ('ahu', 'coil cooling water supply|geometry|fin material', 'fin alumin; fin copper; fin material; fin coated', ''),
  ('ahu', 'coil cooling water supply|geometry|fin space', 'fins per; fin spac; fpi', ''),
  ('ahu', 'coil cooling water supply|geometry|air velocity', 'face velocity; coil velocity', ''),
  ('ahu', 'coil cooling water supply|geometry|drain pan', 'drain pan; condensate pan', ''),
  ('ahu', 'coil cooling water supply|geometry|moisture eliminator', 'moisture eliminator; eliminator', ''),
  ('ahu', 'coil cooling water supply|geometry|connection diam', 'coil connection; header connection', ''),
  ('ahu', 'coil cooling water supply|cooling air side|total capacity', 'cooling capacity; total capacity', ''),
  ('ahu', 'coil cooling water supply|cooling fluid side|pressure drop', 'water pressure drop; water side pressure', ''),
  ('ahu', 'fan supply||quantity', 'fan array; number of fans; multiple fans', ''),
  ('ahu', 'fan return||type', 'centrifugal fan; plug fan; plenum fan; ec fan; backward curved; forward curved; fan type', ''),
  ('ahu', 'fan return||efficiency', 'fan efficien; static efficien', ''),
  ('ahu', 'fan return|motor data|efficiency class', 'motor efficien; ie2; ie3; ie4; ie5; premium efficien', ''),
  ('ahu', 'recuperator heat wheel supply||type', 'heat wheel; energy wheel; rotary wheel; enthalpy wheel; sorption', ''),
  ('ahu', 'recuperator heat wheel supply||dry efficiency (en308)', 'sensible effectiveness; effectiveness; recovery efficien', ''),
  ('ahu', 'recuperator heat wheel supply||diameter', 'wheel diameter', ''),
  ('ahu', 'recuperator heat wheel supply||energy class (en13053)', 'energy recovery class; heat recovery class', ''),
  ('ahu', 'isothermal steam humidifier supply||type', 'humidifier; steam humidifier; steam grid; electrode', ''),
  ('ahu', 'isothermal steam humidifier supply||steam', 'steam capacity; humidification capacity; steam output', ''),
  ('ahu', 'isothermal steam humidifier supply||distributor', 'steam distributor; dispersion tube; steam grid', ''),
  ('ahu', 'electric heater supply||nominal capacity', 'heating capacity; heater capacity; electric heat', ''),
  ('ahu', 'electric heater supply||steps number', 'heating stages; heater steps; step control', ''),
  ('ahu', 'electric heater supply||material', 'heating element; sheathed element; open element', ''),
  ('ahu', 'electric heater supply||electrical protection', 'thermal cutout; high limit; overheat protection; airflow switch', ''),
  ('ahu', 'mechanical characteristic (en1886)||casing strength', 'casing strength; deflection; structural performance; mechanical strength', ''),
  ('ahu', 'mechanical characteristic (en1886)||casing leakage', 'casing leakage; air leakage; leakage class', ''),
  ('ahu', 'mechanical characteristic (en1886)||thermal transmit', 'thermal transmittance; thermal transmit; u value; heat transfer coefficient', ''),
  ('ahu', 'mechanical characteristic (en1886)||thermal bridging', 'thermal bridging; thermal bridge; tb class', ''),
  ('ahu', 'en 13053||supply velocity class', 'velocity class; face velocity class', ''),
  ('ahu', 'en 13053||supply power class', 'power class; fan power class', ''),
  ('ahu', 'unit data||total supply filters eff. epm1', 'epm1; iso epm1', ''),
  ('fcu', 'general||power supply', 'power supply; electrical characteristic; electrical supply; supply voltage; main power; electrical power', ''),
  ('fcu', 'unit data||application air flow(m³/h)', 'air flow; airflow; air volume; air quantity', ''),
  ('fcu', 'unit data||application air flow(m3/h)', 'air flow; airflow; air volume; air quantity', ''),
  ('fcu', 'unit data||application esp (pa)', 'external static; external pressure; esp', ''),
  ('fcu', 'unit data||fan power input (w)', 'power input; power consumption; input power; fan power', ''),
  ('fcu', 'unit data||running current (a)', 'running current; full load current; full load amp; fla', ''),
  ('fcu', 'unit data||net dimension w*d*h (mm)', 'unit dimension; overall dimension; unit height; ceiling void; unit size', ''),
  ('fcu', 'unit data||unit net weight (kg)', 'unit weight; operating weight; net weight', ''),
  ('fcu', 'unit data||fan control type', 'fan speed; three speed; 3 speed; speed control; speed selector', ''),
  ('fcu', 'configuration information||drain pan type', 'drain pan; condensate pan; drip tray; condensate tray', ''),
  ('fcu', 'configuration information||drain pan material', 'drain pan material; drain pan stainless; drain pan galvan; drip tray stainless', ''),
  ('fcu', 'configuration information||drain pan insulation', 'drain pan insulat; drip tray insulat; condensate pan insulat', ''),
  ('fcu', 'configuration information||return plenum type', 'return plenum; plenum box; return air plenum; bottom return; rear return', ''),
  ('fcu', 'configuration information||return plenum insulation', 'plenum insulat', ''),
  ('fcu', 'configuration information||filter type', 'filter; washable filter; aluminium mesh; aluminum mesh; nylon mesh; filter media', ''),
  ('fcu', 'configuration information||coil area (m²)', 'coil face area; coil area', ''),
  ('fcu', 'configuration information||coil area (m2)', 'coil face area; coil area', ''),
  ('fcu', 'configuration information||face velocity(m/s)', 'face velocity; coil velocity', ''),
  ('fcu', 'configuration information||fpi', 'fins per; fin spac; fpi; fin pitch', ''),
  ('fcu', 'configuration information||fins material', 'fin alumin; fin copper; fin material; fin coated; hydrophilic', ''),
  ('fcu', 'configuration information||pipe connection', 'connection side; left hand; right hand; handing', ''),
  ('fcu', 'configuration information||water connection size', 'water connection; connection size; coil connection', ''),
  ('fcu', 'configuration information||motor type', 'motor type; psc motor; ec motor; brushless; dc motor; ac motor', ''),
  ('fcu', 'configuration information||rated motor speed (rpm)', 'motor speed; rpm', ''),
  ('fcu', 'configuration information||fan qty', 'number of fans; fan quantity', ''),
  ('fcu', 'cooling coil (cooling mode)||total cooling capacity(kw)', 'cooling capacity; total capacity; total cooling', ''),
  ('fcu', 'cooling coil (cooling mode)||sensible cooling capacity(kw)', 'sensible capacity; sensible cooling', ''),
  ('fcu', 'cooling coil (cooling mode)||on coil db (°c)', 'entering air; air on coil; entering dry bulb; edb', ''),
  ('fcu', 'cooling coil (cooling mode)||on coil wb (°c)', 'entering wet bulb; ewb', ''),
  ('fcu', 'cooling coil (cooling mode)||ewt(°c)', 'entering water; chilled water supply; water inlet; ewt', ''),
  ('fcu', 'cooling coil (cooling mode)||lwt(°c)', 'leaving water; chilled water return; water outlet; lwt', ''),
  ('fcu', 'cooling coil (cooling mode)||coil rows', 'rows deep; coil rows; row coil; number of rows', ''),
  ('fcu', 'cooling coil (cooling mode)||wpd (kpa)', 'water pressure drop; water side pressure; wpd', ''),
  ('fcu', 'cooling coil (cooling mode)||water flow rate (l/s)', 'water flow; gpm', ''),
  ('fcu', 'cooling coil (heating mode)||heating capacity(kw)', 'heating capacity; hot water coil; heating coil', ''),
  ('fcu', 'electric heater||heating capacity(kw)', 'electric heater; electric heating; heater capacity', ''),
  ('fcu', 'acoustical performance|lw inlet + rad(db(a))|overall', 'sound power; sound level; noise level; noise criteria', ''),
  ('fcu', 'acoustical performance|lw outlet duct(db(a))|overall', 'discharge sound; outlet sound; duct sound', '');

-- Product Options: every value a factory has shown on a datasheet, per row (and per unit model for FCUs), in groups
-- (the rows of one filter, of one fan). A value is "to approve" (approved = false) until a reviewer approves it;
-- only approved values reach users, the chips, the selection list and the Excel (owner, 2026-11-05).
create table projects.po_values (
  factory_id  text not null references projects.factories (id) on delete cascade,
  row_key     text not null,
  model       text not null default '',
  grp         text not null default '',
  value_key   text not null,
  value       text not null,
  times       integer not null default 1,
  hidden      boolean not null default false,
  first_at    timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  approved    boolean not null default false,
  approved_by uuid,
  approved_at timestamptz,
  primary key (factory_id, row_key, model, grp, value_key)
);
alter table projects.po_values enable row level security;
create index po_values_waiting_idx on projects.po_values (factory_id) where not approved;

-- ---------------------------------------------------------------------------
-- 2. Helpers (schema projects, never exposed)
-- ---------------------------------------------------------------------------

-- An active product, or INVALID:product_id.
create or replace function projects.product(p_id text)
returns projects.products language plpgsql security definer set search_path = '' stable as $$
declare v projects.products;
begin
  select * into v from projects.products p where p.id = p_id and p.active;
  if not found then raise exception 'INVALID:product_id'; end if;
  return v;
end $$;

-- Rows that describe one project, not the product: never stored in Product Options (po__skip).
create or replace function projects.po_skip(p_key text)
returns boolean language sql immutable as $$
  select p_key ~ '^general\|\|' and substr(p_key, 10) in ('project', 'reference', 'material name', 'selection software', 'report date', 'product', 'factory', 'unit');
$$;

-- The model a unit is filed under: the Unit Model without a trailing N (a motor variant of the same model).
create or replace function projects.po_model(p_model text)
returns text language sql immutable as $$
  select regexp_replace(left(trim(regexp_replace(coalesce(p_model, ''), '\s+', ' ', 'g')), 60), 'N$', '', 'i');
$$;

-- The group a value belongs to ("Filter Class: ISO Coarse 60%(G4)"); '' when it stands on its own.
create or replace function projects.po_group(p_grp text)
returns text language sql immutable as $$
  select left(trim(regexp_replace(coalesce(p_grp, ''), '\s+', ' ', 'g')), 160);
$$;

-- A value as it is kept: spacing tidied, the quantity in front of an option line removed.
create or replace function projects.po_value(p_key text, p_value text)
returns text language sql immutable as $$
  select left(trim(case when p_key ~ '\|options\|option$'
                        then regexp_replace(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g'), '^\s*\d+\s*x\s+', '', 'i')
                        else regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g') end), 300);
$$;

-- "2x(592x592x48) 2x(490x592x48) 1x(287x592x48)" -> its sizes, without the counts of one project; any other value is itself.
create or replace function projects.po_pieces(p_value text)
returns text[] language plpgsql immutable as $$
declare v text := trim(coalesce(p_value, '')); out text[] := '{}'; m text[]; piece text;
begin
  if v !~* '^(\d+\s*x\s*\(\s*\d[\d.\s]*(x\s*\d[\d.\s]*)+\)\s*)+$' then return array[v]; end if;
  for m in select regexp_matches(v, '\(([^)]+)\)', 'g') loop
    piece := regexp_replace(m[1], '\s+', '', 'g');
    if not (piece = any (out)) then out := out || piece; end if;
  end loop;
  return out;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Row mapping
-- ---------------------------------------------------------------------------

-- Anyone with the tile: the mapping of one product (the reader needs it to build the table).
create or replace function public.projects_dn_rules(p_product_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_prod projects.products;
begin
  perform core.require_tile('projects', null);
  v_prod := projects.product(p_product_id);
  return jsonb_build_object(
    'show_unmapped', coalesce((select s.show_unmapped from projects.dn_map_settings s where s.product_id = v_prod.id), true),
    'rules', (select coalesce(jsonb_agg(jsonb_build_object(
                'key', m.row_key, 'section', m.section, 'sub', m.sub, 'component', m.component, 'show', m.show,
                'label', m.label, 'strip', m.strip, 'response', m.response, 'keywords', m.keywords,
                'new', not m.reviewed, 'in_tree', m.in_tree, 'kind', m.kind, 'place', m.place)
              order by m.sort_order, m.row_key), '[]'::jsonb)
              from projects.dn_map m where m.product_id = v_prod.id));
end $$;
revoke execute on function public.projects_dn_rules(text) from public, anon;
grant execute on function public.projects_dn_rules(text) to authenticated;

-- Right 'edit': called by the reader after every datasheet. Adds the rows this product's mapping has not seen before
-- (shown or not according to the product's setting, marked for review, with the starter keywords); rows already there
-- are not touched. p_rows: [{ key, section, sub, component }, ...] in datasheet order. Only names, never values.
create or replace function public.projects_dn_add_rows(p_product_id text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_prod projects.products; v_show boolean; v_base integer; v_added integer := 0;
begin
  v_user := core.require_tile('projects', 'edit');
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

-- ---------------------------------------------------------------------------
-- 4. Product Options collection
-- ---------------------------------------------------------------------------

-- Right 'edit': called by the reader after every datasheet. p_items: [{ factory, key, value, model, grp }, ...], one per
-- unit and row; factory is the NAME read from the datasheet. Items whose factory is not one of the product's, whose row
-- the mapping does not show or leaves out of the tree, or that describe the project, are ignored. A set of sizes
-- counts as its pieces. At most 300 different values per row, factory and model; a value seen again counts once more.
-- A value new to the factory waits for a reviewer's approval; a value already approved for the row keeps its approval
-- when it comes back in another group.
create or replace function public.projects_po_collect(p_product_id text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_prod projects.products; g record; v_count integer; v_saved integer := 0; v_ok uuid; v_inherit boolean;
begin
  perform core.require_tile('projects', 'edit');
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

-- ---------------------------------------------------------------------------
-- 5. Datasheet tables in a project
-- ---------------------------------------------------------------------------

-- Right 'edit', a project the caller may open: save the table read from a datasheet. p_factory: the factory name the
-- datasheet carries (matched among the product's factories; '' when none or several). A table that covers every unit of
-- an earlier table of the same product in this project replaces it: reading the same datasheet again does not give its
-- units twice. Returns { id, replaced, factory_id }.
create or replace function public.projects_note_save(p_project_id uuid, p_product_id text, p_file_names text, p_columns jsonb, p_rows jsonb, p_factory text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_p projects.projects; v_prod projects.products; v_fac text := ''; v_id uuid;
        v_units integer; v_rows integer; v_bytes integer; v_files text; v_replaced integer;
begin
  v_user := core.require_tile('projects', 'edit');
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

-- Anyone who may open the project: one saved table, to show or download again. NOT_FOUND otherwise.
create or replace function public.projects_note_get(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_n projects.notes; v_p projects.projects;
begin
  v_user := core.require_tile('projects', null);
  select * into v_n from projects.notes n where n.id = p_id;
  if found then select * into v_p from projects.projects p where p.id = v_n.project_id; end if;
  if v_n.id is null or v_p.id is null or not projects.can_open(v_user, v_p) then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object(
    'id', v_n.id, 'project_id', v_p.id, 'project', v_p.name, 'code', v_p.code,
    'product_id', v_n.product_id, 'product', (select pd.name from projects.products pd where pd.id = v_n.product_id),
    'factory_id', v_n.factory_id, 'factory', coalesce((select f.name from projects.factories f where f.id = v_n.factory_id), ''),
    'file_names', v_n.file_names, 'columns', v_n.columns, 'rows', v_n.rows, 'units', v_n.units, 'row_count', v_n.row_count,
    'created_at', v_n.created_at, 'username', v_n.username);
end $$;
revoke execute on function public.projects_note_get(uuid) from public, anon;
grant execute on function public.projects_note_get(uuid) to authenticated;

-- Right 'edit', a project the caller may open: delete one saved table (read the datasheet again to get it back).
create or replace function public.projects_note_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_n projects.notes; v_p projects.projects;
begin
  v_user := core.require_tile('projects', 'edit');
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

-- ---------------------------------------------------------------------------
-- 6. The register and the project page now carry the datasheet tables
-- ---------------------------------------------------------------------------

drop function if exists public.projects_list(text, text, text);
create or replace function public.projects_list(p_q text default null, p_region text default null, p_client_type text default null)
returns table (id uuid, code text, name text, client_type text, client_name text, region text,
               created_by_name text, created_at timestamptz, updated_at timestamptz, members integer, notes integer,
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
           (select count(*)::integer from projects.notes n where n.project_id = h.id),
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
    'runs', '[]'::jsonb,
    'events', (select coalesce(jsonb_agg(jsonb_build_object('username', e.username, 'action', e.action,
                                                          'detail', e.detail, 'created_at', e.created_at)
                                         order by e.id desc), '[]'::jsonb)
               from (select * from projects.events x where x.project_id = v_p.id order by x.id desc limit 100) e));
end $$;
revoke execute on function public.projects_get(uuid) from public, anon;
grant execute on function public.projects_get(uuid) to authenticated;

select core.applied('projects', '005_datasheets');
