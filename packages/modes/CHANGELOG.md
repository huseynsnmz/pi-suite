# Changelog

## [0.7.0]

### Features

- Tells [pi-router](https://github.com/huseynsnmz/pi-router) the current mode, so `plan` mode uses its plan model.

## [0.6.0]

### Features

- The agent can interview you with the `ask_questions` tool: typed answers, yes or no, pick one or pick several, and you can always type your own answer.
- `plan` and `read-only` allow `ask_questions` and `todo` from `pi-frame`. The same names from any other package stay blocked there.

### Security

- Command dialogs now show more invisible characters as visible escapes, including soft hyphens, tag characters and line separators.

## [0.5.0]

### Features

- `plan` and `read-only` allow `web_fetch` and `web_search` from `pi-web`, for research while planning.

## [0.4.0]

### Security

- `git status`, `git diff` and others no longer count as read-only in a repository whose config or hooks could run code. A plain clone could bring these, as a bare repository committed in a subfolder.
- Git after `cd` no longer counts as read-only, since that folder can't be checked.
- `rg*`, `file*` and `date*` can't be added as rules, since those commands can run programs, write files or set the clock.
- A plan mode question shows hidden and reordering characters in its reason too.

### Changed

- The `review-permissions` skill uses the `permissions_review` and `permissions_apply` tools rather than scripts through `bash`. The tool asks you itself, and works when the sandbox would stop a script writing the config. It also reads sessions started from `pi-board`, and keeps its list to 60 items.

## [0.3.0]

### Added

- `/mode default` sets the mode new sessions start in, saved as `defaultMode` in the extension's `config.json`. Resumed sessions keep their own mode, and `yolo` can't be the default.

## [0.2.2]

### Changed

- With `pi-sandbox` installed, yolo only runs inside the sandbox and always keeps deny rules on.

### Added

- The `review-permissions` skill lists what `pi-sandbox` blocked and adds your picks to `sandbox.json`.

## [0.2.1]

### Added

- In the yolo warning, `d` turns deny rules off for this run. They stay on by default. The agent gets separate tools the rules don't name, and the footer says `deny rules off`.
- The `review-permissions` skill also reads past chats.

## [0.2.0]

### Added

- `yolo` mode: approves every permission prompt it's allowed to, with a red warning that only `Enter` confirms. It's off the `Shift+Tab` cycle and doesn't survive a resume. With `pi-permission-system`, add `pi-modes` to `authorizerChain`. `deny` rules still block unless you press `d` in the warning, and `external_directory` and `path` asks can still prompt.
- The `review-permissions` skill: reviews what you approved and what ran in past chats, and adds the rules you pick to the allowlist.

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
