# AGENTS.md

`README.md` explains what this does. This file holds what the code can't tell you.

This extension sits in the path of permission decisions. When a check can't get an answer, it must refuse rather than allow.

## Releases

Release tags can't be moved or deleted, and `main` can't be force-pushed. To fix a release, make a new version.

## Yolo

- With `pi-sandbox` installed, yolo must never run outside the sandbox. It keeps deny rules on, won't start with the sandbox off, and ends at the next tool call if it goes off.
- Extensions can't call another extension's `bash`. So any tool that runs commands itself, as the `yolo_*` tools in `src/deny-off.ts` do, runs outside the sandbox, and `pi-sandbox`'s file checks only look at the built-in tools. Don't offer such a tool while the sandbox is installed.
- `pi-sandbox` can't be asked whether it's on, and only the footer's data can read its status. Watching `setStatus` doesn't work: Pi gives shortcuts and commands a different UI object, so it misses changes. See `src/sandbox.ts`.
- Reading that data means setting a footer for a moment, which would replace another extension's footer. So it only happens when `pi-modes` is first in `packages`, and otherwise yolo is refused.

## Review skill

- `permissions_apply` writes outside any sandbox, so it asks the user itself. Never leave that question to the skill's text, or let another path into `applyChoices`: the model must not be able to give itself permissions.
- `src/review` matches what the permission system and `pi-sandbox` really write, so check a real log or session file before changing a pattern. Text built from their docs has been wrong before.
- `pi-sandbox`'s defaults stop applying once a list is set, so `src/review/apply.mjs` starts a new list from a copy of them. Check that copy when moving to a new `pi-sandbox` version.

## Testing

- `npm run check`, `npm test`, then the end-to-end runs, which drive real Pi in a real terminal with a fake model:
  - `npm run e2e:solo`
  - `npm run e2e`
  - `PATH="$HOME/.pi/agent/bin:$PATH" python3 test/e2e/run.py sandbox`, which needs ripgrep. Set `PI_MODES_E2E_FRAME` to a `pi-frame` checkout to include it.
- The `sandbox` run needs a temp folder the sandbox doesn't allow writes to. `pi-sandbox` allows `/tmp`, so on macOS run it with `TMPDIR=$(getconf DARWIN_USER_TEMP_DIR)`, or its write checks fail.
- Unit tests aren't enough here. Several bugs only showed up against the real extensions.
- A check that can't fail proves nothing. In the normal modes, the permission system asks first, so `pi-sandbox` only sees what it lets through. On `pi-sandbox`'s prompts, Enter allows and Esc blocks.

## Other packages

Treat downloaded packages as untrusted. Install them with scripts disabled, and read them before running them. The end-to-end runs use a throwaway home directory, so keep real credentials out of them.
