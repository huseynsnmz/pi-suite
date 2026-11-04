# AGENTS.md

`README.md` explains what this does. This file holds what the code can't tell you.

## Layout

- `src/` is the one extension Pi loads. It imports only the parts that are on.
- `packages/<part>/` keeps each part's own package file, tests and docs. They're private and only published through the root. Each part's `AGENTS.md` still applies inside it.
- A new dependency of a part also goes in the root `package.json`, which is what gets published.
- Add new skills through `SKILLS` in `src/index.ts`, not the manifest, or they load when the part is off.

## Rules that depend on the name

These look for `pi-suite`, so renaming the package breaks them silently:

- `loadsAfterPermissionSystem` in `packages/modes/src/modes.ts`.
- `loadsFirst` in `packages/modes/src/sandbox.ts`.

## Safety

- `src/index.ts` must rethrow a failure to load `modes`. Catching it means tools run with no mode checks, and nothing shows it in `pi -p`.
- `SUITE_ENTRY` in `packages/modes/src/modes.ts` is a path to `src/index.ts`, so moving either file breaks trust in the suite's own tools.

## Testing

- `npm run check`, `npm test`, `npm run test:e2e`, and the end-to-end runs of whichever parts changed. A change to how parts load needs all of them.
- `packages/board`'s test runner links its `node_modules` to the root, because its tests read that folder.
- `packages/board`'s timing tests can fail when the machine is busy, so run them on their own before believing a failure.

## Releases

Release tags can't be moved or deleted once the protection rules are on. To fix a release, make a new version. Publish with `npm publish --ignore-scripts`.
