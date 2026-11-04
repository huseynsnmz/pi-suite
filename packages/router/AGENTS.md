# AGENTS.md

`README.md` explains what this does. This file holds what the code can't tell you.

- `ctx.model` is a placeholder with `api: "pi-virtual"` while `router/auto` is selected. Calling `complete()` from `pi-ai` or `modelRegistry.complete()` on it throws or fails. Only `modelRegistry.streamSimple()` routes it. That's why `pi-web` and the judge need wiring.
- Return `state` from `route()` only when it changes. Pi stores every new object.
- `router.json` stays global. A repository must not be able to choose where code gets sent.
- The judge's config belongs to `pi-permission-classifier`. Only the user's `/router` may change it, and only its `provider` and `model`. A broken file is left alone.
- The probes on `pi.events` (`pi-router:reader-model`, `pi-modes:mode`) carry an object that whoever knows fills in, so load order doesn't matter.
- Test with `npm run test:e2e`, which runs the whole suite. Run `pi -p` with stdin closed, or it waits on it.
