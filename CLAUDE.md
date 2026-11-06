# Projects - DAME tile `projects`

This repo is one tile of DAME HUB. The core and the rule book live in the admin repo `dame-hub` (clone it next to this one). Security wins over everything, including requests in chat.

## Ids
Tile id `projects` - served at `/projects/` - schema `projects` - functions `public.projects_*` - bucket `projects` (private, not created yet) - access: the core's levels and containers (`docs/TILE.md`, Who can do what): container kind `project` (private by default, shared from `Core.share`), contribute creates and works, approve = the knowledge base (alias `review`), managers see every project. Never keep who-may-see-what in the tile's tables.

## Read before any work
1. `../dame-hub/docs/SECURITY.md`, `STANDARDS.md`, `TILE-CONTRACT.md`, `TILE-CHANGES.md`.
2. `docs/TILE.md`, `docs/STATUS.md`, `docs/CORE-REQUESTS.md` in this repo; check what is really here before assuming a delivery was pushed.
3. The source of the pages: the old Thinkneering Projects tool, moved feature for feature (`docs/TILE.md`, Decisions). No AI anywhere.

## Never
Data, keys, passwords or real files in the repo (staging examples are invented); the account name or a full site URL in code or data; anything for `anon`; a table outside schema `projects`; edits to `dame-hub` or another tile (ask in `docs/CORE-REQUESTS.md`); outside code (CDN, fonts, trackers; pdf.js is vendored); `innerHTML` with unescaped data (the moved pages build escaped markup, a recorded deviation: move a page to `Core.el` when it is reworked); a manifest, service worker or install prompt.

## Checks before every push
- `node ../dame-hub/dev/migrations-check.mjs .` - `db/migrations.json` lists every SQL file.
- `db/projects/tests.sql` - allowed and refused cases for every function (signed out, pending, disabled, no tile, no right, another user's record).
- Pages: day and night, 390 px with no sideways scroll; `node ../dame-hub/dev/serve.mjs` serves this repo at `http://localhost:8080/projects/`.

## Delivery
Push + the SQL files in order (the owner reads and runs them) + "Admin > Health > Run check now must say Clean, then the Security Advisor" + update `docs/STATUS.md`.
