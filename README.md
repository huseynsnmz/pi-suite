# pi-modes

Switch [Pi](https://pi.dev) between permission modes with `Shift+Tab`.

| Mode | What the agent can do | Who approves |
|---|---|---|
| `normal` | Anything your permission rules allow | You |
| `auto` | Anything your permission rules allow | Your permission judge first, then you if it defers |
| `plan` | Read and research, then submit a plan. No edits | You, for any non-read-only command |
| `read-only` | Read and research only | Nobody. Everything else is blocked |

`Shift+Tab` cycles `normal → auto → plan → read-only → normal`. The footer shows the current mode.

The mode is saved per session and survives `--continue`. A new session always starts in `normal`, and nothing in a project can change that.

## Install

```bash
pi install git:github.com/huseynsnmz/pi-modes@v0.1.2
```

Requires Pi 1.5 or newer. Restart Pi after installing.

**Load it first.** `pi install` adds packages to the end of `packages` in `~/.pi/agent/settings.json`. Move `pi-modes` above `@gotgenes/pi-permission-system`. Otherwise, in `plan` and `read-only` you may be asked to approve an action that is then blocked anyway. It's still blocked either way, and the extension warns you at startup.

## Commands

| Input | What it does |
|---|---|
| `Shift+Tab` | Next mode |
| `/mode` | Pick a mode from a list |
| `/mode plan` | Switch directly to a mode |

`Shift+Tab` normally cycles the thinking level, and this extension takes it over. To keep that action on another key, add this to `~/.pi/agent/keybindings.json`:

```json
{ "app.thinking.cycle": "alt+t" }
```

## How plan mode ends

In plan mode the agent calls the `submit_plan` tool. You then choose one of:

- **Approve, normal:** switches to `normal` and the agent starts implementing.
- **Approve, auto:** switches to `auto` and the agent starts implementing.
- **Keep planning:** stays in `plan` and sends your feedback to the agent.

Set `submit_plan` to `allow` in your permission rules so you aren't asked twice.

## Using it with other extensions

**`@gotgenes/pi-permission-system`:** still runs in every mode. This extension only adds restrictions, so a `deny` rule always wins.

**`pi-permission-classifier`:** runs only in `auto`. In every other mode it defers, and the request goes to your normal prompt. Set it up as its README describes, with `permission-judge` in `authorizerChain`. Its `perm-judge:` footer entry stays visible in all modes, so go by the `mode:` entry.

Without a classifier, `auto` behaves like `normal`, and the extension warns you when you switch to it.

**`pi-subagents`:** blocked in `plan` and `read-only`, because a child agent could write files. In `normal` and `auto` it is unchanged.

**`pi-look` and `pi-claude-code-ui`:** no conflicts are expected, as neither uses `Shift+Tab`. The mode appears through Pi's standard status API.

## What plan and read-only allow

- **Allowed tools:** `read`, `grep`, `find`, `ls`, read-only `bash`, and `submit_plan` in plan mode.
- **Blocked tools:** `write`, `edit`, subagents, MCP tools and every other tool, including ones added later.
- **Read-only bash:** a fixed list of commands, such as `ls`, `cat`, `rg` and `git status`. A command is refused if it uses `$`, backticks, redirects, subshells, background jobs, unquoted globs, control characters or a path to a binary. Options that write or run code are refused too, including bundled and abbreviated forms such as `sort -uo` and `sort --outp`. Quote a glob you mean literally, as in `find . -name '*.ts'`.

Any other command asks you in `plan` and is blocked in `read-only`.

## Security limits

These modes keep an honest agent on track. They are not a sandbox.

- **Reads are not restricted by this extension.** A read-only command can still read secrets, so keep `deny` rules for them in your permission system.
- **A repo can already be malicious.** Commands like `git status` can run code from an existing `.git/config`, such as `core.fsmonitor`. Use a container for repos you don't trust.
- **Child agents started earlier keep running.** Switching mode doesn't stop a subagent that is already running.
- **The classifier hook relies on an internal detail.** There is no public way to switch a registered judge on and off, so this extension wraps it when it registers. It uses the global key that `pi-permission-system` documents for its service map. If that breaks, you get a warning on your first prompt that the judge may auto-approve outside `auto`.

## Development

```bash
npm install --ignore-scripts
npm run check
npm test
```

The end-to-end test drives real Pi in a real terminal against a fake model, using a throwaway home directory:

```bash
npm run e2e:solo   # only this extension
npm run e2e        # with the five packages it was built for, in both load orders
```

`npm run e2e` installs those packages from npm with scripts disabled, then starts them.

## Contributing

Issues are welcome, and pull requests are turned off. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

MIT
