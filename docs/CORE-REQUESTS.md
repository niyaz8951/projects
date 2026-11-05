# Core requests - projects

## Open
- 2026-11-05 - Need `core.tile_users(p_tile text)` -> `(id uuid, username text, display_name text)`: the active users who have the tile (through `core.tile_access`, plus super users if the core wants them listed), callable only inside the tile's own functions like `core.display_names` (`revoke execute ... from authenticated`; the function requires the tile with `core.require_tile(p_tile, null)`). Why: the Share sheet of a project lists the people it can be shared with (step 1c, `projects_share_get`). Blocking: partly - sharing works, but the sheet offers nobody until the function exists (`projects_share_get` checks `to_regprocedure('core.tile_users(text)')` and returns `core_missing = true`). A suggested body: `select p.id, p.username, p.display_name from core.profiles p join core.tile_access a on a.user_id = p.id and a.tile_id = p_tile where p.status = 'active' order by p.username`.

## Done
