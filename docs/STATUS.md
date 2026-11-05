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
- 2026-11-05 (owner) - **Direction reset: the tool is moved as it is** (code brought over and adapted; server routes rewritten as `projects_*` functions; no AI; maps out of this tile; rights `edit` and `review`; no members table - admins work in any project). Full decisions in `docs/TILE.md`; the earlier "Maps as step 2" plan is superseded.
- Step 2, **Datasheet notes** - starts after 1b is checked: read a datasheet (AHU, FCU) in the browser (`ds-read.js`, `ds-parse.js`, `ds-fcu.js` from Thinkneering), row keys and the row mapping with starter keywords (`dn_*` tables, seeded from `dn_starter_keywords`), factory read from the datasheet, "read again replaces", the Datasheet Notes view and Excel (`ds-xlsx.js`), tables kept as `jsonb` in `projects`, `po_collect` into Product Options as "to approve". Products and factories as seeded tables.
- Step 3, **Specification and record** - add a specification, `cm-engine` conversion, the record page with library answers pre-filled (green), blue datasheet chips, dashed Product Options chips per row without a datasheet value, Focus mode without proposals, compare page, the two compliance Excel downloads and the project Excel.
- Step 4, **Compliance review** (`library.html`, right `review`).
- Step 5, **Product Options** (`product-options`, `mapping.html`, right `review`).
- Open question for later: delete or close a project, once it holds records and tables.
