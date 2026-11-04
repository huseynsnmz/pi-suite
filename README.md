# pi-modes

Switch [Pi](https://pi.dev) between permission modes with `Shift+Tab`.

| Mode | What the agent can do | Who approves |
|---|---|---|
| `normal` | Anything your permission rules allow | You |
| `auto` | Anything your permission rules allow | Your permission judge first, then you if it defers |
| `plan` | Read and research, then submit a plan. No edits | You, for any non-read-only command |
| `read-only` | Read and research only | Nobody. Everything else is blocked |
| `yolo` | Anything your `deny` rules don't block, or anything at all if you turn them off | Nobody. It doesn't ask |

`Shift+Tab` cycles `normal → auto → plan → read-only → normal`. The footer shows the current mode. `yolo` is off this cycle: you start it with `/mode yolo`.

The mode is saved per session and survives `--continue`, except `yolo`, which resumes as `normal`. A new session always starts in `normal`, and nothing in a project can change that.

## Quick start

Requires Pi 1.5 or newer.

1. Install it:

   ```bash
   pi install npm:@huseynsnmz/pi-modes@0.6.0
   ```

2. Move it above `@gotgenes/pi-permission-system`, because `pi install` adds packages last. Otherwise, in `plan` and `read-only` you may be asked to approve an action that is then blocked anyway. It stays blocked either way, and the extension warns you at startup. Skip this step if you don't use that package.

   ```bash
   f=~/.pi/agent/settings.json
   jq '.packages |= (map(select(tostring | contains("pi-modes"))) + map(select(tostring | contains("pi-modes") | not)))' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
   ```

3. If you use `pi-permission-system`, allow plans so you aren't asked twice:

   ```bash
   f=~/.pi/agent/extensions/pi-permission-system/config.json
   jq '.permission.submit_plan = "allow"' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
   ```

4. Restart Pi. The footer shows `mode: normal`, and `Shift+Tab` changes the mode.

To install from git instead, use `pi install git:github.com/huseynsnmz/pi-modes@v0.5.0`.

## Commands

| Input | What it does |
|---|---|
| `Shift+Tab` | Next mode |
| `/mode` | Pick a mode from a list |
| `/mode plan` | Switch directly to a mode |
| `/mode yolo` | Start `yolo`, after a warning |
| `/mode default` | Pick the mode new sessions start in |
| `/mode default plan` | Set it directly |

The default is saved as `defaultMode` in `~/.pi/agent/extensions/pi-modes/config.json`. A resumed session keeps the mode it was in. `yolo` can't be the default, because it has to be asked for each time.

`Shift+Tab` normally cycles the thinking level, and this extension takes it over. To keep that action on another key, add this to `~/.pi/agent/keybindings.json`:

```json
{ "app.thinking.cycle": "alt+t" }
```

## Yolo

For when you've decided not to be asked. `/mode yolo` shows a red warning, and only `Enter` starts it. `Shift+Tab` goes back to `normal`.

With `pi-permission-system`, add the link to its config once, then restart Pi. The link does nothing outside `yolo`:

```bash
f=~/.pi/agent/extensions/pi-permission-system/config.json
jq '.authorizerChain = ((.authorizerChain // []) + ["pi-modes"] | unique)' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
```

What it does and doesn't cover:

- **`deny` rules still block, unless you choose otherwise.** A link only answers questions the rules left open. In the warning, `d` turns them off for this run. The agent then gets separate tools (`yolo_bash`, `yolo_read`, `yolo_write`, `yolo_edit`) that your rules don't name, and the footer says `deny rules off`. Other tools, like MCP, stay under the rules, and so do subagents. A top-level `"*": "deny"` still blocks these tools. Leaving yolo puts everything back.
- **With `pi-sandbox`, yolo stays inside the sandbox.** Deny rules can't be turned off, because the tools that ignore them would run outside it. Yolo won't start with the sandbox off, and if you turn the sandbox off during yolo, the next tool call is blocked and you're back in `normal`. Load `pi-modes` first in `packages`, or yolo is refused. `pi-sandbox`'s own prompts still appear in yolo, and Enter on one picks "Allow for this session".
- **Subagents are covered.** Their prompts come to your session, and yolo answers them.
- **Access outside the project can still ask.** The permission system doesn't let any link approve its `external_directory` and `path` surfaces. To stop those prompts too, set those rules to `allow` yourself. That applies in every mode.
- **The review log says who approved.** Approvals are recorded under the link name `pi-modes`.

The permission system's own `yoloMode` setting is different: it applies to every open Pi session and stays on until you turn it off.

## Review what you keep approving

The package includes a skill that turns repeated approvals into allowlist rules. Run it now and then:

```
/skill:review-permissions
```

It reads the permission system's review log and your past chats, and groups what you approved and what ran. The agent rates each group and shows you the list, and only the rules you pick are added. You approve the exact list in a dialog, which the agent can't answer for you. It refuses rules that are too broad, such as `git *`, or that cover `git push`, `rm`, `curl` or an interpreter like `python`. They back up the config first and place new rules so that your `deny` rules still win. What ran in `yolo` is ignored, and so are commands that look like they hold a secret.

With `pi-sandbox`, it also lists the paths and domains the sandbox blocked. What you pick goes in `~/.pi/agent/sandbox.json`. It refuses credential folders, whole home folders, and places where a written file runs later, such as shell profiles and git hooks.

## How plan mode ends

In plan mode the agent calls the `submit_plan` tool. You then choose one of:

- **Approve, normal:** switches to `normal` and the agent starts implementing.
- **Approve, auto:** switches to `auto` and the agent starts implementing.
- **Keep planning:** stays in `plan` and sends your feedback to the agent.

## Interviews

The agent can ask you questions with the `ask_questions` tool, in any mode: typed answers, yes or no, pick one, or pick several. It asks one dialog at a time, up to 6 questions a call, and you can always type your own answer instead of the options. `Esc` stops the rest, and the agent is told not to guess them.

Each dialog starts with `Agent question`, so you can tell it from Pi's permission prompts, and a typed answer says it goes to the model. An answer is only information. It doesn't approve anything, so permission rules and modes still apply to whatever the agent does next. Don't type a secret because a question asks for one: it goes to your model provider and into the session file, and no permission rule covers it.

In `pi -p` the agent is told nobody can answer. A client without the terminal's dialogs, using RPC, gets pick-several as a typed answer.

## Using it with other extensions

**`@gotgenes/pi-permission-system`:** still runs in every mode. This extension only adds restrictions, so a `deny` rule always wins. With `"*": "ask"`, it asks before `ask_questions` and `todo` too. Add `"ask_questions": "allow"` and `"todo": "allow"` to its `permission` rules to skip that.

**`pi-permission-classifier`:** runs only in `auto`. In every other mode it defers, and the request goes to your normal prompt. Set it up as its README describes, with `permission-judge` in `authorizerChain`. Its `perm-judge:` footer entry stays visible in all modes, so go by the `mode:` entry. If the classifier is listed after `pi-permission-system`, it only registers during your first prompt, and `auto` starts working from then on.

Without a classifier, `auto` behaves like `normal`, and the extension warns you when you switch to it.

**`pi-web`:** `web_fetch` and `web_search` are allowed in `plan` and `read-only`, as they only read.


**`pi-subagents`:** blocked in `plan` and `read-only`, because a child agent could write files. In `normal` and `auto` it is unchanged.

**`pi-frame`:** the editor frame follows the mode, and turns red in `yolo`. Its `todo` checklist is allowed in `plan` and `read-only`, as it changes nothing outside the session. A tool named `todo` or `ask_questions` from any other package is still blocked there.

**`pi-look` and `pi-claude-code-ui`:** no conflicts are expected, as neither uses `Shift+Tab`. The mode appears through Pi's standard status API.

## What plan and read-only allow

- **Allowed tools:** `read`, `grep`, `find`, `ls`, read-only `bash`, and `submit_plan` in plan mode.
- **Blocked tools:** `write`, `edit`, subagents, MCP tools and every other tool, including ones added later.
- **Read-only bash:** a fixed list of commands, such as `ls`, `cat`, `rg` and `git status`. A command is refused if it uses `$`, backticks, redirects, subshells, background jobs, unquoted globs, control characters or a path to a binary. Options that write or run code are refused too, including bundled and abbreviated forms such as `sort -uo` and `sort --outp`. Quote a glob you mean literally, as in `find . -name '*.ts'`.

Any other command asks you in `plan` and is blocked in `read-only`.

## Security limits

These modes keep an honest agent on track. They are not a sandbox.

- **Reads are not restricted by this extension.** A read-only command can still read secrets, so keep `deny` rules for them in your permission system.
- **A repo can already be malicious.** Git can run code from a repository's config and hooks, even for `git status`, and a plain clone can bring them. In `plan` and `read-only`, git commands stop counting as read-only where a repository sets anything unusual or has a hook that reading can fire, which covers what's known today. Other tools can have their own ways in, so use a container for repos you don't trust.
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
npm run e2e        # with the five packages it was built for, in three load orders
```

`npm run e2e` installs those packages from npm with scripts disabled, then starts them.

## Contributing

Issues are welcome, and pull requests are turned off. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

MIT
