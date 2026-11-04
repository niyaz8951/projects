# Projects tile

Tile id `projects` - repo `projects` - address `/projects/` - schema `projects` - functions `public.projects_*` - private bucket `projects` (not created yet, see Data).

## What it does
A register of the team's projects. Everyone with the tile sees every project; users with the right `edit` create projects and change their details. Each project is opened from the list and holds its details and history now; in later steps its location on a map, a compliance review and product options. Everything a page shows is data from Supabase.

## Rights
- `edit` - create a project, change the details of any project.

The owner enters the same list in Admin > Tiles. Reading needs only access to the tile.

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
- `projects_list(p_q, p_region, p_client_type)` - the register with `total`; `p_q` matches name, client name or code. Anyone with the tile.
- `projects_create(p_name, p_client_type, p_client_name, p_region)` - right `edit`; returns `{ id, code }`. `INVALID:name`, `INVALID:client_type`, `INVALID:client_name`, `INVALID:region`.
- `projects_get(p_id)` - one project with its last 100 events. Anyone with the tile; `NOT_FOUND` otherwise.
- `projects_update(p_id, p_name, p_client_type, p_client_name, p_region)` - right `edit`; writes one history line listing the changed fields; no change, no line.

## Decisions
- 2026-11-04 - **Features learned from the old tool** (`Thinkneering`, `tools/projects`; no code, data or layout copied): a project is name + client type + client name + region, with a code `P-<year>-<number>` that is never reused; the register has find and filters (region, client type), a count, a download of the list, and each project a details form and a history. The old tool's "share with a person" is replaced by DAME access: everyone with the tile sees every project, which is what a team register is for. Its "created by" filter is not built; the column is shown instead.
- 2026-11-04 - Pick lists are data (`projects.lists`), so the owner can add a region or client type with one SQL line rather than a page change.
- 2026-11-04 - Usernames are stored next to the ids (`created_by_name`, `updated_by_name`, `events.username`) so lists need no join into `core`; `core.display_names` can refresh them later if renames ever matter.
- 2026-11-04 - No delete in step 1. A project will hold maps, reviews and options; what deletion does to those is decided when they exist.
- 2026-11-04 - Tile colour: blue until the owner chooses one in Admin > Tiles.
