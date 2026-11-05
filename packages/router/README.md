# pi-router

Part of [pi-suite](../../README.md). Turn it off with `/suite off router`.

Adds `router/auto` to [Pi](https://pi.dev): one choice in `/model` that uses a strong model to plan and a cheaper one to build, and gives the page reader, the permission judge and subagents their own models.

## Quick start

Requires Pi 1.5 or newer.

```bash
pi install npm:@huseynsnmz/pi-suite@0.2.4
```

Log in to the providers you want with `/login`, run `/router` to choose a model for each role, then pick `router/auto` in `/model`. It's always listed there, and until `plan` and `build` are set it stops with a message telling you to run `/router`.

In `/model`, `Enter` selects a model for this session and `Ctrl+S` saves it as your default for new sessions.

## Roles

| Role | What it does | With none set |
|---|---|---|
| `plan` | Reads and plans, up to the first edit, and everything in `plan` mode | Required |
| `build` | Everything after that, and compaction summaries | Required |
| `reader` | Reads web pages for [pi-web](https://github.com/huseynsnmz/pi-suite/tree/main/packages/web) | Same as `build` |
| `mastermind` | Reviews past conversations for `/mastermind`, and writes rules for the other models | Not set |
| `judge` | Decides permission asks for `pi-permission-classifier` | See below |
| `subagent` | Runs subagents that use `router/auto` | Same as `build` |
| `fallback` | Takes over when a provider is overloaded or rate limited | Retries on the same model |

`/router` saves them under `router` in `~/.pi/agent/suite.json`, apart from `judge`, which goes in the judge's own config. `/suite` opens the same screen.

```json
{
  "router": {
    "plan": "anthropic/claude-opus-5-5",
    "build": "anthropic/claude-haiku-5-5",
    "fallback": "openai/gpt-5.6-luna"
  }
}
```

There's no setting per project, so a repository can't choose where your code gets sent.

## Reasoning per role

After you choose a model for a role, `/router` asks how much reasoning it should use, offering only the levels that model has. It's saved next to the roles:

```json
{
  "router": {
    "plan": "anthropic/claude-opus-5-5",
    "build": "anthropic/claude-haiku-5-5",
    "thinking": { "plan": "high", "build": "low" }
  }
}
```

A role with no level of its own uses the one you pick with `/effort`. Changing a role's model clears its level, because the new model may not have it. A retry keeps the level of the request that failed. `reader` and `subagent` with no model of their own use `build`'s level. `judge` has no level here, as it's set in the judge's own config.

## How it decides

```
 new session ──> plan model ──── first successful edit ───> build model
                     ▲                                          │
                     └── plan mode on ──────────────────────────┤
                                                                │
                     leaving plan mode ─────────────────────────┘
```

- Moving from `plan` to `build` happens once in a session. It loses the prompt cache one time, as any change of model does.
- The session stays on `build` after that. For a hard follow-up, switch to `plan` mode, or start a new session.
- If a request fails because the provider is overloaded, it moves to `fallback` for the rest of that turn. The next message tries the first choice again. Any other failure retries on the same model.
- A role whose model is missing or has no login stops that request with an error naming it, and so do broken router settings. The router doesn't pick another model for you.
- Leaving `plan` mode counts as finishing planning, whether you approved a plan or changed mode.
- The roles only apply while `router/auto` is selected. On any other model, nothing goes to them, and pages are read as if the router weren't there.
- `/suite off router` moves the session to the model that last answered. If `router/auto` is your saved default, later sessions use another available model, as Pi does for any model that no longer exists.

The phase follows the session tree, so a branch keeps its own.

## With other extensions

**`modes`:** tells the router the mode. With it off, the router only goes by the first edit.

**`web`:** your `readerModel` in the web settings still wins over the `reader` role.

**`frame`:** shows who answered, such as `Auto → Haiku`. Pi's own footer already does.

**`pi-permission-classifier`:** it calls its model directly, which can't work with a virtual model. With `router/auto` selected and no judge model, every ask comes to you, and the router warns you. Setting `judge` in `/router` writes the model into the judge's own config, changing only its `provider` and `model`, so `/permission-model` shows the same choice. Run `/reload` afterwards. The `judge` role doesn't have to be the cheap model, and I'd choose carefully, because it decides what runs in `auto`. A project's own judge config can still override it.

**`pi-subagents`:** a subagent uses the `subagent` role only if its model is `router/auto`, for example through `model: "inherit"`. A subagent with its own model ignores the router. The router recognises a subagent by `PI_SUBAGENT_CHILD=1`, and that was tested by setting the variable rather than through a real subagent.

**`pi-board`:** its model list includes `router/auto`, but sessions started that way haven't been tested.

## Limits

- **It isn't a cost limit.** It chooses models and doesn't stop spending.
- **Changing model mid-session can lower quality.** The build model sees the plan model's work, but not its private reasoning.
- **It doesn't judge how hard a task is.** A one-line change still starts on the plan model.
- **Another extension that calls the virtual model directly gets the `build` model.**

## Development

```bash
npm install --ignore-scripts
npm run check
npm test
npm run test:e2e
```

The end-to-end run drives real Pi in a real terminal with a fake model, using all of pi-suite and the real permission extensions.
