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
- 2026-11-05 - **A project comes with its tools; "Maps" are rule and knowledge maps, not locations** (owner, corrects the step-2 wording in the Claude project instructions). The flow learned from the old tool (features only, nothing copied):
  1. **Datasheet reader**: a product datasheet PDF (AHU, FCU; chiller later) read in the browser into one table, Section / Component / one column per unit, differences between units marked; the rows shown and their wording come from the **row mapping** (one list per product: show, name, spec keywords, remove text, standard response; it grows by itself with rows no admin has seen). The table is saved in the project; the values of the shown rows are collected per **factory** (read from the datasheet) into Product Options.
  2. **Product Options**: per product and factory, the tree Section > Component > values seen on datasheets, with editors' special options and notes, values taken out, rows left out; FCU trees per model as tables; Excel. Also the home of the row mapping.
  3. **Compliance review**: a specification (PDF or pasted text) converted into clauses, Part / section / clause; a **library** per product and factory of every clause met with its answer (normalised text is the key; Internal Comments with `#` rules); a project **record** to read and fill (six answers, remarks, full-screen one clause at a time on a phone), Excel down and up; users' answers reach the library only through an editor's "Use this answer". For each clause the page shows **suggestions**: the library answer on an exact match, the datasheet row its spec keywords point at (a number in the clause compared by code with the datasheet value, units converted; a class on its scale), earlier answers in the same record, and the rules from the maps.
  4. **Maps**: trees that grow left to right (map and outline views, notes, special notes, images, links, import/export as a plain outline, verified / to verify). Two kinds: **knowledge** (product and process understanding) and the **rule book**, whose branches are rules read by code like if / else if: `When: <words>` - `Section: <words>` - `Part: 1|2|3` - `Unless: <words>` - `Answer: <one of six>` - `Remark: <text>`, in a fixed decision order (datasheet -> library -> earlier answer -> rule -> other projects). No AI model in DAME: the rule book is the whole engine.
  5. The project page ties it together: a "Next step" card, tool tiles (blue when the project holds that data), the records and tables of the project, "Specification beside datasheet", history, and "Download project" as one Excel.
- 2026-11-05 - **One tile for the whole flow.** Datasheet tables, product options, the compliance library and the maps all live in schema `projects` and bucket `projects`: the contract forbids a tile to read another tile's tables, and compliance suggestions read all three. Each part gets its own right (declared when its step is built: `library` for the compliance library and reviewing answers, `options` for product options and the row mapping, `maps` for managing shared maps; `edit` stays for projects and records). The PDF reader (pdf.js) is copied into `vendor/` with its licence; PDFs are read in the browser and the datasheet PDF itself is never uploaded; a specification PDF is stored in the bucket only if the owner wants it kept.
- 2026-11-05 - **Full read of the old tool done.** Feature inventory (five notes, no code) is in the Claude project "DAME - Projects" as `thinkneering-reference.md` + `thinkneering-1..4-*.md`; every later step reads the matching note before building. Learned from it, beyond the flow above: six fixed answers; the parser's rules (parts, sections, labels, wrapped lines, page furniture, front matter); the library key = normalised text per product+factory with `#` rules in Internal Comments; the owner's Excel formats (compliance workbook with the 5-row header, library workbook, project workbook, datasheet workbook); datasheet values wait for an admin's approval; option / duty kinds and component cards in Product Options; the rule-book templates for AHU, FCU and chiller (the owner's own rules, to seed step 2); the code-only decision order (datasheet -> closest approved option -> Not Applicable for an absent conditional part -> library at 0.90 -> earlier answer -> rule -> other project).
- 2026-11-05 - **Order, keeping the owner's sequence and the dependencies:** step 2 **Maps** (rule book and knowledge maps; stands alone); step 3 **Compliance review** (conversion, library, record, Excel; suggestions from the library, earlier answers and the rule book); step 4 **Product options** with the row mapping and the **datasheet reader** (tables saved in the project, values collected per factory), which then switches on the datasheet suggestions and "Specification beside datasheet" in the record; step 5 the project page glue (Next step card, tool tiles, Download project). Staging samples are invented: no real specification, datasheet, factory value or customer.
