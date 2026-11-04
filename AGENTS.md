# AGENTS.md

`README.md` explains what this does. This file holds what the code can't tell you.

## Releases

Release tags can't be moved or deleted, and `main` can't be force-pushed. To fix a release, make a new version.

## Things that are easy to break

- A memory reaches every later session's system prompt, so what gets stored is a way in. Reviews read only what the user and the model said, never tool output, and a person sees proposals before they're saved. Don't loosen either without a replacement.
- The system prompt section is worked out once a session. Rebuilding it each turn throws away the provider's prompt cache.
- Use `node:sqlite`, with no native dependency. Pi installs packages with scripts off here, so `better-sqlite3` wouldn't build.
- Several Pis use one database at a time, including every session on `pi-board`. Keep WAL and the busy timeout.

## Testing

- `npm run check`, then `npm test`. It needs Node 22.18 or newer.
