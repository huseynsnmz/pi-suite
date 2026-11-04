# AGENTS.md

`README.md` and `docs/` explain what this does. This file holds what the code can't tell you.

## Releases

Release tags can't be moved or deleted, and `main` can't be force-pushed. To fix a release, make a new version.

## Writing about the project

Describe it neutrally as a fork of `@zhuxixi/pi-agent-board`. Don't compare the two or list problems with the original.

## Testing

- `npm run typecheck`, then `npm test`. `npm test` needs Node 24, since Node 26 rejects `--experimental-transform-types`.
- Set `TMPDIR` to a short path, such as `/tmp/x`. On macOS, the default is long enough to break the control sockets, and about 30 tests fail with `listen EINVAL`.
- Most of the suite drives the board and attach view through `test-support/`. A hung test usually means a key it sends has changed.
- `pi-frame`'s end-to-end test covers the board in real Pi with a fake model: `PI_FRAME_E2E_AFTER=<this folder> python3 test/e2e/run.py` from there.
- These fail on this code and the original alike: `attach selection mirror` needs X11's PRIMARY selection, and `step 15 integration` hits a limit on piped output.

## Things that are easy to break

- Anything held from `session_start` goes stale when the session is replaced, and using it takes Pi down. Stop it in `session_shutdown`.
- Don't send text to a session's terminal while a dialog is open. Enter would answer the dialog. See `reply` in `src/runtime/service.mjs`.
- The board must not start a second Pi on the session file open behind it. See `prewarmSelected` and `dashboardAttachLoop`.
- Letters type into the task input, so a new shortcut needs `Ctrl`. macOS terminals often don't send `Alt`.

## Other packages

Treat downloaded packages as untrusted. Install them with scripts disabled, and read them before running them.
