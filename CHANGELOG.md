# Changelog

## [0.2.6]

### Changes

- The READMEs are rewritten to be shorter, with the same shape for every part.

### Fixes

- Finished reasoning now collapses by default, as Pi's setting for it was off unless you had changed it. `Ctrl+T` still opens it, and is saved.

## [0.2.5]

### Security

- `auto`: a path Pi rewrites before writing, such as `@.git/hooks/pre-commit`, `@/etc/x` or `file:///etc/x`, went past the project check. These now go to the judge.
- `auto`: `.GIT` and `.Github` on a case-insensitive disk went past the guarded folder check.
- The `cd` rules matched `cd <project>/../x`, paths the shell works out later, and symlinks out of the project. They now ask. Projects that already have the rules get the new ones at the next start.
- An agent started in the default mode, not its parent's, so a parent in `normal` could have a child in `auto`. It now takes its parent's mode. From `plan` it's `read-only`, and from `yolo` it's `normal`.
- A tool named `agent` from another package no longer skips the judge and your review.
- `/review-permissions` refuses `cd*`, which also matches `cdk deploy`.

### Fixes

- A `cd` to a folder that isn't there could run somewhere else: `cd build && rm -rf *` in a folder with no `build` went to the project's top `build`. It now fails as in a shell.
- The bash folder is kept across `/reload` and `/resume`, and follows moves in `/tree`.
- With no `bash` rules and a catch-all of `allow`, adding the `cd` rules made every command ask. `/review-permissions` had the same problem. Rules now start from your catch-all.
- `cd` rules work in projects with a space in the path.
- `/mastermind` no longer marks sessions as reviewed when the answer was cut off or can't be read, and a retry keeps the proposals it didn't repeat.
- Non-English text in an agent's answer can't be garbled where it's split across chunks.

## [0.2.4]

### Features

- `/mastermind`: a strong model, chosen as the new `mastermind` role in `/router`, reads past conversations and writes a short playbook that other models get on every run. You approve every rule in an editor. `/mastermind compact` shortens it, and `/mastermind show` shows it.
- New part, `subagent`: the `agent` tool hands a task to a fresh agent and gives back its answer. `explore` can only read, and also works in `plan` and `read-only`. `general` can do everything, and its permission asks come to your session.
- A `cd` at the start of a bash command carries over to later commands while it stays in the project.
- `/review-permissions` reports what the permission judge decided, and why it deferred.

### Changes

- `auto` no longer sends `edit` and `write` on ordinary project files to the judge. `.git`, `.pi`, `.claude`, `.husky`, `.github`, `.vscode`, `.envrc` and paths outside the project still go to it.
- The first time you start Pi in a project, pi-modes allows `cd` inside that project in your bash rules, with a backup, so you aren't asked about each one. A `cd` elsewhere still asks.

### Development

- `npm test` takes seconds. Board's tests that start real processes moved to `npm run test:all`, and `npm run test:e2e` runs every suite at once.

## [0.2.3]

### Features

- Router: each role can have its own reasoning level, chosen in `/router` from what that role's model offers.
- Up and Down with one line typed go through past prompts that start with it. With nothing typed they also reach this folder's other sessions.
- With `hideThinkingBlock` on, reasoning shows while it's written and collapses when the message is done. `Ctrl+T` opens it.
- New part, off until you run `/suite on subscription`: Claude models on your Claude login, based on pi-claude-subscription. It asks before anything more is billed as extra usage. See its README for the limits and what Anthropic's terms say.

- One settings file, `~/.pi/agent/suite.json`, with a section for each part. `/suite` now opens each part's settings as well as turning it on or off. Old files move in the first time Pi starts, and stay as `.bak`.

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
