# AGENTS.md

`README.md` and `docs/` explain what this does. This file holds what the code can't tell you.

## Releases

Release tags can't be moved or deleted, and `main` can't be force-pushed. To fix a release, make a new version.

## Writing about the project

Describe it neutrally as a fork of `@adeildo/pi-look`. Don't compare the two or list problems with `pi-look`. It's a fork so it can be managed here, not a competitor.

## Shortcuts

- `Alt+S` belongs to `pi-sandbox`, which can't be rebound. The settings screen asks for it from `pi-kit`, so `withSettingsKey` in `src/index.ts` moves that request.
- Settings open with `Ctrl+S`, but the shortcut isn't registered on it. Pi warns at every start about a shortcut on `Ctrl+S`, since its pickers use that key, so `src/ui/editor.ts` passes the key on to a private shortcut. The private key is sent in kitty form, because the legacy form doesn't match once the kitty protocol is on.
- The start card offers `/sandbox-disable` rather than a key, so a stray keypress can't turn the sandbox off. `pi-sandbox` still registers `Alt+S` itself.
- Before taking a key, check Pi's defaults and the other extensions. If two extensions want one, the last loaded wins and Pi warns.

## Testing

- `bun run check`, `bun test`, then `bun run e2e`, which drives real Pi in a real terminal with a fake model.
- Run the end-to-end test with the extensions this one lives beside, not only alone:
  `PATH="$HOME/.pi/agent/bin:$PATH" PI_FRAME_E2E_AFTER=npm:pi-sandbox@0.7.3 python3 test/e2e/run.py`
- `PI_FRAME_E2E_WITH` adds packages loaded before this one, and `PI_FRAME_E2E_AFTER` adds them after.
- A check that can't fail proves nothing. Use the result of `term.wait`, and make sure a fake model actually reaches the code being tested.
- The fake model reports no token use, so its runs don't show cost or token numbers on the bottom line.

## Other packages

Treat downloaded packages as untrusted. Install them with scripts disabled, and read them before running them. The end-to-end test uses a throwaway home directory, so keep real credentials out of it.
