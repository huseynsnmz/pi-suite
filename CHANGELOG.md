# Changelog

## [0.1.1]

### Security

- Fixed read-only bash bypasses that could write files or run code in `plan` and `read-only`. These used bundled, attached or abbreviated options (`sort -uo`, `sort --outp`, `fd -Hx`, `tree -ao`, `file -bC`), `uniq - file`, extra options on `git stash list`, and unquoted globs that expand into flags. Upgrade from 0.1.0.
- Plan-mode prompts now show control and bidirectional characters as visible escapes, so a command can't hide part of itself.

### Changed

- `fd`, `tree` and `file` are no longer treated as read-only. `sort`, `uniq`, `date` and `printf` accept fewer options. These now ask in `plan` and are blocked in `read-only`.

## [0.1.0]

- Added `normal`, `auto`, `plan` and `read-only` modes, switched with `Shift+Tab` or `/mode`.
- Added plan approval through the `submit_plan` tool.
- Added per-session control of the `pi-permission-classifier` judge.
