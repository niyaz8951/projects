# Projects tile - status

## Built
- 2026-11-04 - **Step 1, project register** (waiting for the owner's check): `index.html` (list, find, filters, create, CSV download), `project.html` (details, edit details, history), `assets/pr.css`, `assets/pr-common.js`, `assets/pr-list.js`, `assets/pr-project.js`, `db/projects/001_init.sql`, `db/projects/tests.sql`, `docs/TILE.md`, `docs/CORE-REQUESTS.md`.

## SQL applied
| File | Staging | Live |
|---|---|---|
| `db/projects/001_init.sql` | - | - |

## Owner, to check step 1
1. Admin > Tiles: tile `projects` exists with the right `edit`; switch it **on** (functions refuse while it is off); give yourself access (the super user has every tile anyway).
2. SQL editor: `db/projects/001_init.sql`, then `select * from core.security_check();` (no rows), then `db/projects/tests.sql` (ends with `ALL PROJECTS TESTS PASSED`, rolls itself back; needs the demo accounts from `db/core/seed-staging.sql`).
3. GitHub Pages on the tile repo: branch `main`, root.
4. Open `/projects/` on a laptop and a phone, day and night:
   - empty register, then "New project" with an invented name: the sheet checks each field, the project opens on its page with a code `P-2026-0001`.
   - back to the list: find by part of the name, by the client, by the code; the region and client type filters; the count; "Download list (CSV)" opens in Excel.
   - on the project page: "Edit details" changes the client type, History shows the change with who and when; the code does not change.
   - phone at 390 px: the list stacks into one block per project, no sideways page scroll; the sheet fits.
   - a user without `edit` sees no "New project" and no "Edit details" (and the database refuses either call anyway).

## Next
- Step 2, maps: project locations (how the map is drawn is decided then within the rules; coordinates and addresses as data in `projects`).
- Step 3, compliance review inside a project. Step 4, product options inside a project.
- With the first step that stores files: bucket `projects` with policies on `<project-id>/...`.
- Open question for later: delete or close a project, once it holds maps, reviews and options.
