# Projects tile - status

## Built
- 2026-11-05 - **Step 1b, visibility** (waiting for the owner's check): `db/projects/002_visibility.sql` (a user sees and edits his own projects; tile admins and the super user see all; `projects.can_open`, `projects_list` returns `sees_all`), `db/projects/tests.sql` (other user's record refused, admin opens any), `assets/pr-list.js` + `index.html` ("Created by" column and intro line only for admins), `docs/TILE.md` (who sees what; the old tool's project page recorded as the target for steps 3-4).
- 2026-11-04 - **Step 1, project register** (checked by the owner 2026-11-05, first project created on live): `index.html` (list, find, filters, create, CSV download), `project.html` (details, edit details, history), `assets/pr.css`, `assets/pr-common.js`, `assets/pr-list.js`, `assets/pr-project.js`, `db/projects/001_init.sql`, `db/projects/tests.sql`, `docs/TILE.md`, `docs/CORE-REQUESTS.md`.

## SQL applied
| File | Staging | Live |
|---|---|---|
| `db/projects/001_init.sql` | - | 2026-11-05 |
| `db/projects/002_visibility.sql` | - | - |

## Owner, to check step 1b
1. SQL editor: `db/projects/002_visibility.sql` (after 001), then `select * from core.security_check();` (no rows). On staging also `db/projects/tests.sql` (ends with `ALL PROJECTS TESTS PASSED`, rolls itself back; needs the demo accounts from `db/core/seed-staging.sql`). Until 002 runs, the list page still works (it ignores the missing `sees_all` and shows the "Created by" column to admins by the page's own guess).
2. Push the repo (GitHub Pages picks it up in about a minute).
3. As the super user, `/projects/`: the intro says "Every project of the team", the "Created by" column shows, the existing project `P-2026-0001` opens and edits as before.
4. Create a second account (Admin > Users > New user), give it the tile `projects` with `edit`, sign in as it on a phone: the intro says "Your projects", the list is empty ("You have no projects yet"), no "Created by" column; create one project with an invented name; it shows. Paste the super user's project link `/projects/project.html?id=<id>` in that session: "Project not found".
5. Back as the super user: both projects in the list, with the second account under "Created by"; open and "Edit details" on the second account's project works, and its History names the super user.
6. Make the second account a tile admin (Admin > Tiles > access): it now sees both projects and the column.

## Checked
- 2026-11-05 - Step 1 checked by the owner on live: tile on, 001 applied, first project `P-2026-0001` created, list and project page shown.

## Next
- **Correction 2026-11-05:** "Maps" in step 2 are the rule book and knowledge maps (what the compliance suggestions read as if / else if), not project locations; the owner updates the wording in the Claude project instructions. Details and the whole flow: `docs/TILE.md`, decisions 2026-11-05.
- Step 2, **Maps**: `projects.maps`, `projects.map_nodes`, `projects.map_images` (images shrunk in the browser, thumbnails); pages `maps.html` (list, search, add) and `map.html?id=` (tree and outline views, read / edit, special notes, links, import / export outline, verify); kind = knowledge or rule book (from a template); sharing per map: only me / team reads / team edits; right `maps`. The rule format and the decision order are fixed here so step 3 can run them.
- Step 3, **Compliance review**: products and factories as data; `projects.spec_runs` + `spec_lines` (conversion in the browser, pdf.js in `vendor/`), `projects.library` per product and factory, record page with six answers and remarks, Excel down and up, "Use this answer" for editors (right `library`); suggestions from library, earlier answers and rule book.
- Step 4, **Product options** + **datasheet reader**: row mapping per product, reader for AHU and FCU, tables saved in the project (`projects.datasheets`), values per factory (`projects.option_values`, `option_extras`), tree and series tables, Excel; right `options`. Then datasheet chips, number comparison and "Specification beside datasheet" in the record.
- Step 5, project page glue: Next step card, tool tiles, Download project (one Excel), history lines for every action.
- Open question for later: delete or close a project, once it holds records, tables and options.
