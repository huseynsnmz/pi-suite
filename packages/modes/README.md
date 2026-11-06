# modes

Part of [pi-suite](../../README.md). Turn it off with `/suite off modes`.

Choose how much the agent can do without asking. `Shift+Tab` changes the mode, and the footer shows the current one.

| Mode | What the agent can do | Who approves |
|---|---|---|
| `normal` | Anything your permission rules allow | You |
| `auto` | The same, plus edits to ordinary project files | Your permission judge, then you if it defers |
| `plan` | Read and research, then submit a plan | You, for any command that isn't read-only |
| `read-only` | Read and research | Nobody. Everything else is blocked |
| `yolo` | Anything your `deny` rules don't block | Nobody |

## Commands

| Input | What it does |
|---|---|
| `Shift+Tab` | Next mode: `normal → auto → plan → read-only` |
| `/mode` or `/mode plan` | Pick a mode, or switch directly |
| `/mode yolo` | Start `yolo`, after a warning |
| `/mode default` or `/mode default plan` | Choose the mode new sessions start in |
| `/skill:review-permissions` | Turn what you keep approving into rules |

A resumed session keeps its mode, except `yolo`, which comes back as `normal`. New sessions start in your default, and nothing in a project can change that.

`Shift+Tab` normally cycles the thinking level. To keep that on another key, add `{ "app.thinking.cycle": "alt+t" }` to `~/.pi/agent/keybindings.json`.

## Setup with the permission system

All of this is optional, and only applies if you use `@gotgenes/pi-permission-system`.

1. Move pi-suite above it in `packages` in `~/.pi/agent/settings.json`. Otherwise `plan` and `read-only` may ask you to approve something they then block.
2. In `~/.pi/agent/extensions/pi-permission-system/config.json`, add what you want:

```json
{
  "authorizerChain": ["pi-modes", "permission-judge"],
  "permission": { "submit_plan": "allow", "ask_questions": "allow", "todo": "allow" }
}
```

- **`pi-modes`** in the chain makes `yolo` work, and does nothing in other modes.
- **`permission-judge`** comes from `pi-permission-classifier`, which `auto` needs. Without it, `auto` behaves like `normal` and warns you.
- **The `allow` rules** stop you being asked about plans, questions and the todo list.

Restart Pi afterwards. With no judge or `pi-modes` link, also add `"agent": "allow"`, or each `agent` call asks.

## `auto`

The judge decides each ask, and only runs in this mode. Some asks skip it, so they don't come to you and a slow judge doesn't hold them up. `deny` rules still apply.

- **Edits and writes to project files.**
- **pi-suite's own tools for memory, the playbook, todos, questions and the web.** They only change what pi-suite keeps, or have checks of their own. The judge defers what it doesn't know, so it would send each one to you. A tool with the same name from another package still goes to the judge.

These still go to the judge:

- Paths outside the project
- `.git`, `.pi`, `.claude`, `.husky`, `.github`, `.vscode` and `.envrc`
- Paths Pi rewrites before writing, such as `@src/a.go` or a `file:` URL

Other files can run code too, such as `package.json` scripts, so use `normal` where that matters.

If the judge passes 3 asks in a row to you without judging them, because its model is too slow, failing or missing, pi-modes tells you once a session, with what to do. A slow model is the usual cause: the judge waits 5 seconds by default, so give it a fast model of its own as `judge` in `/router`.

If `auto` still asks too much, run `/skill:review-permissions`.

## `plan`

The agent reads, then calls `submit_plan`. You choose **Approve, normal**, **Approve, auto**, or **Keep planning** with feedback.

`plan` and `read-only` allow `read`, `grep`, `find`, `ls`, pi-suite's `todo`, `ask_questions`, `web_fetch`, `web_search`, `explore` agents and read-only `bash`. Every other tool is blocked, including ones added later. Read-only `bash` is a fixed list of commands such as `ls`, `cat`, `rg` and `git status`. It refuses `$`, backticks, redirects, subshells, unquoted globs, and options that write or run code. Any other command asks in `plan` and is blocked in `read-only`.

## `yolo`

`/mode yolo` shows a red warning, and only `Enter` starts it. `Shift+Tab` goes back to `normal`.

- **`deny` rules still block**, unless you press `d` in the warning. That lasts for this run, and the footer says `deny rules off`.
- **`pi-sandbox` stays on.** `yolo` won't start with the sandbox off, stops if you turn it off, and can't turn off `deny` rules. Load pi-suite first in `packages`.
- **Agents are covered.** Their asks come to your session, and `yolo` answers them.
- **Paths outside the project can still ask**, as no link can approve those. Set those rules to `allow` yourself to stop this.

## Bash keeps its folder

A `cd` at the start of a command carries over to later commands while it stays in the project, and the model is told. It's still there after `/reload` or `/resume`. A move outside runs once, then resets. A folder that isn't there fails as it would in a shell. `read`, `edit` and `write` paths don't move.

So that `cd x && go test` doesn't ask about the `cd`, the first start in a project adds rules allowing a `cd` inside it. It keeps a backup, tells you, and leaves them removed if you remove them. A `cd` elsewhere, or through `..` or a symlink, still asks.

Don't add a blanket `"cd *": "allow"`. It lets `cd /elsewhere && touch new` go unchecked.

## Questions

The agent can ask you questions with `ask_questions`, in any mode. Each dialog starts with `Agent question`. An answer is only information and approves nothing. Don't type a secret into one: it goes to your model provider and the session file.

## Reviewing permissions

`/skill:review-permissions` groups what you approved and what ran, and shows you suggested rules. You approve the exact list in a dialog the agent can't answer. It backs up your config, and your `deny` rules still win. It refuses rules that are too broad, or that cover things like `git push`, `rm`, `curl` or `python`.

It also helps the judge. It says why the judge deferred, and suggests notes on what's routine for you, such as "Running `npm test` is routine." The judge reads them on its next ask. They go in a section of their own in your global `AGENTS.md` in `~/.pi/agent`, since the judge only reads Pi's context files, so the agent reads them too. Notes are refused if they're broad, such as "always allow git", and the section stays under 2,000 characters.

`/mastermind permissions` runs it on your strong model.

With `pi-sandbox`, it also lists what the sandbox blocked, and refuses credential folders and places where a written file runs later.

## Security limits

These modes keep an honest agent on track. They are not a sandbox.

- **Reads aren't restricted here.** A read-only command can still read secrets, so keep `deny` rules for them.
- **A repository can already be malicious.** Git can run code from its config and hooks. `plan` and `read-only` stop treating git as read-only where a repository sets something unusual, but other tools have their own ways in. Use a container.
- **Some `cd` tricks get through.** A symlink reached through a shell glob such as `cd <project>/l*`, or made in the same command, isn't caught.
- **Scripts can't change things**, except with `codemode.mode` set to `only`, where a script's edits don't show in the transcript. A `codemode` script's `models` calls aren't checked, so they can send data to a model you have a login for.
- **Running agents keep running** when you switch mode.
- **The judge hook relies on an internal detail** of the permission system. If it breaks, you get a warning that the judge may approve outside `auto`.
