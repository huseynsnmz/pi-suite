# Changelog

## [Unreleased]

### Features

- `/clear` clears the conversation and starts a new session.
- `/security-review` reviews your changes for security problems.
- Your messages keep the color of the mode you sent them in, and name it unless it's `normal`.

### Changes

- Board notices now show at the bottom of the screen, go away by themselves, and no longer move the list.
- Deleting a session on the board moves the cursor up one in the same group instead of to the top.
- Fewer outside packages run inside Pi. `@adeildo/pi-kit` is now a copy in `packages/frame/src/kit`, while word diffs and page-to-Markdown are our own code in place of `diff` and `turndown`. Removing `c8`, used only for a coverage script, clears the open `minimatch` alert.

## [0.1.0]

### Features

- One package for `pi-modes`, `pi-router`, `pi-web`, `pi-memory`, `pi-frame` and `pi-board`, with their history.
- `/suite` and `~/.pi/agent/suite.json` turn each part on or off.
- `router/auto`, a new virtual model. The other parts now work with it: `modes` shares the mode, `web` asks it for a reader, `frame` shows which model answered, and `/router` sets the judge's model.

### Changes

- In `plan` and `read-only`, `todo`, `ask_questions`, `web_fetch` and `web_search` are only allowed from pi-suite itself.
- If `modes` fails to load, Pi stops rather than running without it.
