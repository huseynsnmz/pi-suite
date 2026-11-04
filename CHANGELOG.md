# Changelog

## [0.1.0]

### Features

- One package for `pi-modes`, `pi-router`, `pi-web`, `pi-memory`, `pi-frame` and `pi-board`, with their history.
- `/suite` and `~/.pi/agent/suite.json` turn each part on or off.
- `router/auto`, a new virtual model. The other parts now work with it: `modes` shares the mode, `web` asks it for a reader, `frame` shows which model answered, and `/router` sets the judge's model.

### Changes

- In `plan` and `read-only`, `todo`, `ask_questions`, `web_fetch` and `web_search` are only allowed from pi-suite itself.
- If `modes` fails to load, Pi stops rather than running without it.
