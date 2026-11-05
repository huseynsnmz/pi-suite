# Changelog

## [Unreleased]

### Features

- Router: each role can have its own reasoning level, chosen in `/router` from what that role's model offers.
- Up and Down with one line typed go through past prompts that start with it. With nothing typed they also reach this folder's other sessions.
- With `hideThinkingBlock` on, reasoning shows while it's written and collapses when the message is done. `Ctrl+T` opens it.
- New part, `subscription`: Claude models on your Claude login, based on pi-claude-subscription. It asks before anything more is billed as extra usage. See its README for the limits and what Anthropic's terms say.

### Fixes

- `router/auto` is always listed in `/model`, and says to run `/router` until `plan` and `build` are set.
- `/clear` keeps the current model and reasoning level.

## [0.2.2]

### Fixes

- Pi's `codemode` tool now works in plan and read-only modes. Each tool a script calls is still checked, so a script can't write there. Another package's tool named `codemode` stays blocked.
- A script or other tool can no longer call `edit`, `write`, `powershell`, or bash that isn't read-only, in any mode. The model makes those as their own tool calls, so you see each one and `router/auto` sees that editing has started. With `codemode.mode` set to `only` this is off in normal, auto and yolo, because scripts are then the only way to reach tools.

## [0.2.1]

### Fixes

- `/security-review` no longer lets a repository's git config run programs: it turns off hooks and stops if the repository sets a filter. `.gitattributes` can't hide a change as binary, a failed git call is reported instead of reading as no changes, and it sees the whole repository from a subfolder.
- Page-to-Markdown: a link can't break out of its address, only web and mail links stay links, a page of spaces can't hang Pi, code blocks keep their spacing, words beside bold text and links stay apart, and list items outside `<li>` are kept.
- Message colors: resuming a session the same length as the last one, and messages sent with a skill, now show the right mode.
- The board's `verify` script no longer calls the removed coverage script.

## [0.2.0]

### Features

- `/clear` clears the conversation and starts a new session.
- `/security-review` reviews your changes for security problems.
- Your messages keep the color of the mode you sent them in, and name it unless it's `normal`.

### Changes

- Board notices now show at the bottom of the screen, go away by themselves, and no longer move the list.
- Deleting a session on the board moves the cursor up one in the same group instead of to the top.
- Fewer outside packages run inside Pi. The parts of `@adeildo/pi-kit` that frame uses are now a copy in `packages/frame/src/kit`, while word diffs and page-to-Markdown are our own code in place of `diff` and `turndown`. Removing `c8`, used only for a coverage script, clears the open `minimatch` alert.

## [0.1.0]

### Features

- One package for `pi-modes`, `pi-router`, `pi-web`, `pi-memory`, `pi-frame` and `pi-board`, with their history.
- `/suite` and `~/.pi/agent/suite.json` turn each part on or off.
- `router/auto`, a new virtual model. The other parts now work with it: `modes` shares the mode, `web` asks it for a reader, `frame` shows which model answered, and `/router` sets the judge's model.

### Changes

- In `plan` and `read-only`, `todo`, `ask_questions`, `web_fetch` and `web_search` are only allowed from pi-suite itself.
- If `modes` fails to load, Pi stops rather than running without it.
