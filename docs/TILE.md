# Projects tile

Tile id `projects` - repo `projects` - address `/projects/` - schema `projects` - functions `public.projects_*` - private bucket `projects` (not created yet, see Data).

## What it does
A register of the team's projects. A user sees and works in **his own projects**; a **tile admin and the super user** see and work in every project (step 1b). Users with the right `edit` create projects and change their details. Each project is opened from the list and holds its details and history now; in later steps its location on a map, a compliance review and product options. Everything a page shows is data from Supabase.

## Rights
- `edit` - create a project, change the details of a project the user may open.

The owner enters the same list in Admin > Tiles. Reading needs only access to the tile.

## Who sees what
- A plain user: the projects he created (list, open, edit with `edit`). Another user's project answers `NOT_FOUND`, never `NO_RIGHT`, so nothing tells him whether an id exists.
- A tile admin (Admin > Tiles > access, "admin") and the super user: every project of every user; the list shows a "Created by" column and the intro line says so.
- The database decides (`projects.can_open`); the page only hides columns and buttons.
- Later steps inherit this: a location, review or option is reached only through a project the caller may open.

## Pages
- `index.html` - the register: find (name, client or code), filters by region and client type, the list (last changed first, 300 at most), "New project" (right `edit`), "Download list (CSV)" built in the browser from the rows shown.
- `project.html?id=<uuid>` - one project: code, details, "Edit details" (right `edit`), history.

## Data
- `projects.projects` - `id`, `code` (`P-<year>-<number>`, unique, never reused, never changes), `name`, `client_type`, `client_name`, `region`, `created_by` + `created_by_name`, `created_at`, `updated_by` + `updated_by_name`, `updated_at`. RLS on, no policies.
- `projects.events` - what happened in a project (`created`, `details changed` with the changed fields), shown as History. RLS on, no policies.
- `projects.lists` - the pick lists `client_type` and `region` (generic values: kinds of client, countries). RLS on, no policies.
- `projects.counters` - one counter per name, only goes up (`project` for the codes). RLS on, no policies.
- Bucket `projects`: **not created in step 1** - nothing uploads yet. It comes with the first step that stores files, with policies tied to the project id (`<project-id>/...`) and `core.has_tile`.

## Functions
- `projects_lists()` - the pick lists. Anyone with the tile.
- `projects_list(p_q, p_region, p_client_type)` - the register with `total` and `sees_all`; own projects, or all for an admin; `p_q` matches name, client name or code. Anyone with the tile.
- `projects_create(p_name, p_client_type, p_client_name, p_region)` - right `edit`; returns `{ id, code }`. `INVALID:name`, `INVALID:client_type`, `INVALID:client_name`, `INVALID:region`.
- `projects_get(p_id)` - one project with its last 100 events, if the caller may open it; `NOT_FOUND` otherwise.
- `projects_update(p_id, p_name, p_client_type, p_client_name, p_region)` - right `edit`, own project or admin (`NOT_FOUND` otherwise); writes one history line listing the changed fields; no change, no line.
- `projects.can_open(profile, created_by)` - internal helper: creator, tile admin or super user.

## Decisions
- 2026-11-04 - **Features learned from the old tool** (`Thinkneering`, `tools/projects`; no code, data or layout copied): a project is name + client type + client name + region, with a code `P-<year>-<number>` that is never reused; the register has find and filters (region, client type), a count, a download of the list, and each project a details form and a history. The old tool's "share with a person" is replaced by DAME access: everyone with the tile sees every project, which is what a team register is for. Its "created by" filter is not built; the column is shown instead.
- 2026-11-04 - Pick lists are data (`projects.lists`), so the owner can add a region or client type with one SQL line rather than a page change.
- 2026-11-04 - Usernames are stored next to the ids (`created_by_name`, `updated_by_name`, `events.username`) so lists need no join into `core`; `core.display_names` can refresh them later if renames ever matter.
- 2026-11-04 - No delete in step 1. A project will hold maps, reviews and options; what deletion does to those is decided when they exist.
- 2026-11-04 - Tile colour: blue until the owner chooses one in Admin > Tiles.
- 2026-11-05 - **Own projects; admins see all** (owner). Replaces "everyone with the tile sees every project" from step 1: a user sees only the projects he created; tile admins and the super user see every project. `db/projects/002_visibility.sql`. The old tool's "share a project with a colleague" is not built; an admin can work in any project, which covers the hand-over case. Sharing can be added later as a `projects.members` table if the team asks.
- 2026-11-05 - **A project comes with its tools** (owner): the project page is the place where the work is done, as in the old tool. What the old project page held (features only, nothing copied): a "Next step" card (what to do next, with a progress line); tool tiles "Read a datasheet" and "Add a specification" (blue when the project holds that data, grey when not, only for tools the user has); the compliance records of the project grouped by product, each opened as a record to read and fill with Compliance / Remarks per clause, downloadable and re-uploadable as Excel; the saved datasheet tables (one column per unit, differences marked); "Specification beside datasheet" per product that has both; a read-only panel of the factory options for a row (Product Options); "Download project" as one Excel (Project information, then Specs-<Product> and Notes-<Product> sheets); history with every action. Planned for this tile in this order: step 2 maps (location on the project page), step 3 compliance review (specification in, clauses filled, record and Excel, bucket `projects` for the PDFs), step 4 product options; datasheet tables and the specification-beside-datasheet view come with step 3 or 4 once the owner decides where the datasheet reader lives.
