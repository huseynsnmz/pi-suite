# router

Part of [pi-suite](../../README.md). Turn it off with `/suite off router`.

Adds one choice to `/model`, `router/auto`, which uses a strong model to plan and a cheaper one to build.

## Use

1. Log in to your providers with `/login`.
2. Run `/router` and choose a model for each role. Set at least `plan` and `build`.
3. Pick `router/auto` in `/model`. `Ctrl+S` there saves it as your default.

## Roles

| Role | What it does | If not set |
|---|---|---|
| `plan` | Reads and plans, up to the first edit, and all of `plan` mode | Required |
| `build` | Everything after that, and compaction summaries | Required |
| `reader` | Reads web pages for [web](../web/README.md) | Uses `build` |
| `subagent` | Runs [agents](../subagent/README.md) | Uses `build` |
| `fallback` | Takes over when a provider is overloaded | Retries the same model |
| `mastermind` | Improves how the others work with [`/mastermind`](../memory/README.md): the playbook, permissions and memories | `/mastermind` won't run |
| `judge` | Decides permission asks in `auto` | See [Limits](#limits) |

After you pick a model, `/router` asks how much reasoning that role should use. A role with no level uses `/effort`.

```json
{
  "router": {
    "plan": "anthropic/claude-opus-5-5",
    "build": "anthropic/claude-haiku-5-5",
    "fallback": "openai/gpt-5.6-luna",
    "thinking": { "plan": "high", "build": "low" }
  }
}
```

That's the `router` section of `~/.pi/agent/suite.json`. `judge` is saved in the judge's own config, so run `/reload` after changing it. It decides what runs in `auto`, so don't just give it the cheapest model.

## How it decides

```
 new session ──> plan model ──── first successful edit ───> build model
                     ▲                                          │
                     └── plan mode on ──────────────────────────┤
                     leaving plan mode ─────────────────────────┘
```

- **The move to `build` happens once in a session**, and stays there. For a hard follow-up, switch to `plan` mode or start a new session.
- **Leaving `plan` mode counts as finished planning**, whether or not you approved a plan.
- **An overloaded provider** moves to `fallback` for that turn, and the next message tries the first choice again.
- **A missing model or login** stops with an error naming it. The router never picks another model for you.
- **Each branch of a session** keeps its own phase.

The roles only apply while `router/auto` is selected.

## Limits

- **It isn't a cost limit.** It chooses models and doesn't stop spending.
- **It doesn't judge how hard a task is.** A one-line change still starts on the plan model.
- **Changing model can lower quality.** The build model sees the plan model's work, but not its reasoning.
- **The judge can't run on `router/auto`.** With no `judge` model, every ask comes to you, and the router warns you. A project's own judge config can still override it.
- **`readerModel` in the web settings** wins over the `reader` role.
- **`pi-board` sessions on `router/auto`** haven't been tested.
