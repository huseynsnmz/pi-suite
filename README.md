# pi-frame

A redrawn screen for [Pi](https://pi.dev): a start card, an editor framed with the branch and the model, a box around every tool call, and a footer with what the session costs.

**This is a fork of [`@adeildo/pi-look`](https://github.com/felipeadeildo/pi-harness/tree/main/packages/look) 6.0.0 by [adeildo](https://adeildo.dev).** The design and almost all of the code are theirs, under the MIT license. This fork renames it, fixes the problems listed below, and will change to suit how its maintainer works. If you want the original with the rest of pi-harness, use that instead.

## Quick start

Requires Pi 1.5 or newer.

1. Remove `pi-look` if you have it, because the two draw the same screen:

   ```bash
   pi remove npm:@adeildo/pi-look
   ```

2. Install it:

   ```bash
   pi install npm:@huseynsnmz/pi-frame@0.1.0
   ```

3. Restart Pi. The start card says `π-frame`.

Your `pi-look` settings don't carry over. Press `Alt+S` and open the **Frame** tab to set them again. On a Mac, `Alt` needs "Use Option as Meta" in Terminal.app, or Left Option set to `Esc+` in iTerm2.

## What's different from pi-look

| Problem in pi-look 6.0.0 | In pi-frame |
|---|---|
| `git status` ran at session start and after every tool call, and it could run programs named in the repository's config (`core.fsmonitor`, filters, a submodule's config) outside any permission check | Those are turned off for this call. In a repository whose own config defines a filter, the git counts stay hidden, because no option can turn off every filter |
| The `Alt+O` view and third-party tool boxes passed escape sequences from tool output and model arguments to the terminal, including clipboard writes and window titles | Everything except colors is removed, along with control characters and bidirectional overrides. This also covers branch names, folders, statuses and pull request titles |
| The default icons needed a Nerd Font, and without one they showed as boxes or `[?]` | `auto` means plain Unicode, or ASCII without UTF-8. Nerd Font icons are a setting |
| `gh` started on every launch, even for a GitLab remote | `gh` starts only when a remote is on a GitHub host |
| The file listing the folders you've worked in was readable by other users and written in place | It's readable only by you and written atomically |

I found no malicious code in `pi-look` or `pi-kit`. These are bugs, and the author wasn't asked to review the fixes.

## What you see

- **Start card:** the folder, branch and model, then only what changed or waits on you since your last session in that folder: conflicts, a branch behind its remote, a failed CI run, a pull request waiting on you. On a quiet day it says nothing is new. Without `gh`, a network or a GitHub remote, those lines stay out.
- **Tool boxes:** each call shows the command, who allowed it and why, the output and the time. An edit shows the diff, with only the changed words highlighted.
- **Above the editor:** a stopwatch, the number of model calls, and how the last call went. Messages you send while the agent works wait here in a dashed frame.
- **Editor frame:** the branch, folder, model and how full the context is.
- **Footer:** cost, tokens, cache, speeds, and anything other extensions report, such as the `mode:` from [pi-modes](https://github.com/huseynsnmz/pi-modes).

Some pieces, such as rooms, boards, peers and the remote page, appear only with other pi-harness packages installed.

| Key | What it does |
|---|---|
| `Alt+O` | Scroll through the session's tool output, one call at a time |
| `Ctrl+O` | Expand every call in the transcript |
| `Alt+S` | Settings: icons, editor frame style, framed messages |

More detail is in [How it works](docs/how-it-works.md) and the [reference](docs/reference.md).

## Using it with other extensions

**`pi-modes`, `pi-permission-system`, `pi-subagents`:** no conflicts were found. The automated run covers `pi-modes` and `pi-subagents` together, and `pi-permission-system` hasn't been run with pi-frame.

**`pi-claude-code-ui`:** it also draws tool calls, so list it above pi-frame in `packages`. `pi install` adds packages last, so this is the order you get if you install pi-frame second. Even then, it draws a call to a tool that doesn't exist outside pi-frame's box, so escape sequences in that call's arguments still reach the terminal. In the other order, or with `pi-claude-code-ui` alone, arguments of real tools leak too. To close this, remove `pi-claude-code-ui`.

## Security limits

- **This isn't a sandbox.** Use a container for repositories you don't trust.
- **It only cleans what it draws.** Pi draws assistant messages and some entries itself.
- **`gh` still runs in GitHub repositories,** and it calls `git` for reads such as the remote list.
- **The `git status` protections cover the ways to run code that I know of.** New Git options could add others.
- **`@adeildo/pi-kit` is still an upstream dependency,** pinned to exact version 6.0.0. Its settings stay in `~/.pi/agent/extensions/pi-harness/settings.json`.
- **Another session's view isn't fully covered.** Opening one needs other pi-harness packages, and that view hasn't been tested.

## Development

```bash
npm install --ignore-scripts
npm run check
npm test          # needs bun
npm run e2e       # real Pi in a real terminal with a fake model, in a throwaway home directory
```

To test with other packages, list them in `PI_FRAME_E2E_WITH`, or in `PI_FRAME_E2E_AFTER` to load them later.

## Contributing

Issues are welcome, and pull requests are turned off. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Credits and license

MIT. See [LICENSE](LICENSE), which keeps the original copyright notice.

- [pi-look and pi-harness](https://github.com/felipeadeildo/pi-harness) by [adeildo](https://adeildo.dev)
- The framed editor comes from [pi-open-tui](https://github.com/OldSuns/pi-open-tui), by way of pi-look.
- The segments with priorities come from [oh-my-pi](https://github.com/can1357/oh-my-pi), by way of pi-look.
