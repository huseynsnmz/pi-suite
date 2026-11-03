# Changelog

## [0.2.0]

### Added

- `yolo` mode: approves every permission prompt it's allowed to, with a red warning that only `Enter` confirms. It's off the `Shift+Tab` cycle and doesn't survive a resume. With `pi-permission-system`, add `pi-modes` to `authorizerChain`. `deny` rules still block, and `external_directory` and `path` asks can still prompt.
- The `review-permissions` skill: reviews what you approved and adds the rules you pick to the allowlist.

## [0.1.4]

### Fixed

- Fixed a false "Auto has no permission judge" warning when `pi-permission-classifier` loads after `pi-permission-system`, where it only registers during the first prompt.
- Moved the "could not take control" check to after every extension has had the chance to register.

## [0.1.3]

### Changed

- Published to npm as `@huseynsnmz/pi-modes`.
- Added a quick start to the README.

## [0.1.2]

### Changed

- Warns at startup if this extension loads after `pi-permission-system`, which causes needless approval prompts in `plan` and `read-only`.

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
