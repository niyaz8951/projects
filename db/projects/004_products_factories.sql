-- Projects tile, step 1d (base tables): the products and the factories, as the old tool's cm_products / cm_factories.
-- Seeds are configuration (no internal data): the product names and the factory names of the old tool, nothing else.
-- Later steps hang on them: a datasheet table is of one product and names a factory (step 2), a specification
-- is converted for one product and factory (step 3), the library and Product Options are per factory (steps 4-5).
-- Touches only: schema projects and functions public.projects_*. Run after 003_members.sql.

-- A product: what a datasheet or a specification is about. The id is the short word used in row keys and files.
create table projects.products (
  id         text primary key check (id ~ '^[a-z][a-z0-9-]{1,19}$'),
  name       text not null check (char_length(name) between 1 and 40),
  sort_order integer not null default 100,
  active     boolean not null default true
);
alter table projects.products enable row level security;

-- A factory of one product: the compliance library and the Product Options are kept per factory.
create table projects.factories (
  id         text primary key check (id ~ '^[a-z][a-z0-9-]{1,39}$'),
  product_id text not null references projects.products (id),
  name       text not null check (char_length(name) between 1 and 40),
  sort_order integer not null default 100,
  active     boolean not null default true,
  unique (product_id, name)
);
alter table projects.factories enable row level security;
create index factories_product_idx on projects.factories (product_id, sort_order);

insert into projects.products (id, name, sort_order) values ('ahu', 'AHU', 10), ('fcu', 'FCU', 20), ('chiller', 'Chiller', 30);
insert into projects.factories (id, product_id, name, sort_order) values
  ('ahu-dubai', 'ahu', 'Dubai', 10), ('ahu-riyadh', 'ahu', 'Riyadh', 20),
  ('fcu-shenzhen', 'fcu', 'Shenzhen', 10), ('fcu-riyadh', 'fcu', 'Riyadh', 20),
  ('chiller-italy', 'chiller', 'Italy', 10), ('chiller-jeddah', 'chiller', 'Jeddah', 20);

-- Anyone with the tile: the active products, each with its active factories, in order. Used by the pickers of
-- "Read a datasheet" (step 2) and "Add a specification" (step 3); nothing on the pages of step 1 calls it yet.
create or replace function public.projects_products()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_tile('projects', null);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name,
            'factories', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name) order by f.sort_order, f.name), '[]'::jsonb)
                          from projects.factories f where f.product_id = p.id and f.active))
          order by p.sort_order, p.name), '[]'::jsonb)
          from projects.products p where p.active);
end $$;
revoke execute on function public.projects_products() from public, anon;
grant execute on function public.projects_products() to authenticated;

select core.applied('projects', '004_products_factories');
