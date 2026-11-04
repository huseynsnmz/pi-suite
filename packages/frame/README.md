# pi-frame

Part of [pi-suite](../../README.md). Turn it off with `/suite off frame`.

A redrawn screen for [Pi](https://pi.dev): a start card, an editor framed with the branch and the model, a box around every tool call, and a footer with what the session costs.

It started as a fork of [`@adeildo/pi-look`](https://github.com/felipeadeildo/pi-harness/tree/main/packages/look) 6.0.0 by [adeildo](https://adeildo.dev), so the design and most of the code are theirs, under the MIT license. I keep this fork so I can shape it around how I work. If you want the original with the rest of pi-harness, use that instead.

## Quick start

Requires Pi 1.5 or newer.

1. Remove `pi-look` if you have it, because the two draw the same screen:

   ```bash
   pi remove npm:@adeildo/pi-look
   ```

2. Install it:

   ```bash
   pi install npm:@huseynsnmz/pi-suite@0.2.1
   ```

3. Restart Pi. The start card says `π-frame`.

Your `pi-look` settings don't carry over. Press `Ctrl+S` and open the **Frame** tab to set them again.

On a Mac, `Alt` means the Option key, which needs Left Option set to `Esc+` in iTerm2, `"terminal": { "option_as_meta": true }` in Zed, or "Use Option as Meta" in Terminal.app. Otherwise Option types a character such as `ß`. In a terminal that uses the kitty keyboard protocol, such as Ghostty or kitty, `Cmd+S` and `Cmd+O` work too, and the start card says so.

## What you see

- **Start card:** the folder, branch and model, then only what changed or waits on you since your last session in that folder: conflicts, a branch behind its remote, a failed CI run, a pull or merge request waiting on you. On a quiet day it says nothing is new. Below that, a row each for the context, skills, prompts and extensions Pi loaded, with `+N` for what doesn't fit. `Ctrl+O` shows them in full. CI and request lines use `gh` for a GitHub remote and `glab` for a GitLab one, and stay out without the tool or a network.
- **Tool boxes:** each call shows the command, who allowed it and why, the output, when it started and how long it took.
- **Timings:** a line under each response shows when the call started, the wait for the first token, server latency, thinking time, total time, any stall and the speed. It updates as the response is written. Turn it off under **Timings** in the Frame tab. An edit shows the diff, with only the changed words highlighted.
- **Todo list:** for work with several steps, the agent keeps a checklist in a frame above the editor, with what it's doing now highlighted. Finished items make way first when the list is long, and `Ctrl+O` shows all of it. A finished list leaves at your next prompt. The list stays with its branch of the session, and the agent gets it back after compaction.
- **Above the editor:** a stopwatch, the number of model calls, and how the last call went. Messages you send while the agent works wait here in a dashed frame.
- **Editor frame:** the branch, folder, model, effort and how full the context is. With [pi-modes](https://github.com/huseynsnmz/pi-suite/tree/main/packages/modes), its color follows the mode: yellow for `auto`, the accent color for `plan`, green for `read-only`, red for `yolo`, using your theme's versions of those colors. In `normal` it stays Pi's own color.
- **Footer:** first the `mode:` from [pi-modes](https://github.com/huseynsnmz/pi-suite/tree/main/packages/modes), then a divider and what other extensions report, then cost, tokens, cache and speeds.

Some pieces, such as rooms, boards, peers and the remote page, appear only with other pi-harness packages installed.

| Key | What it does |
|---|---|
| `Ctrl+C` | Stops a run and says `Aborted`. With nothing running, it clears the editor and says to press it again within 2 seconds to exit |
| `Ctrl+R` | Search what you've typed, here and in this folder's other sessions. `Ctrl+R` again goes further back, `Enter` sends, `Esc` cancels, any other key keeps the match to edit. It replaces Pi's Rename on this key; `/name` still renames |
| `Alt+O` | Scroll through the session's tool output, one call at a time |
| `Ctrl+O` | Expand every call in the transcript |
| `/todos` | Show the agent's todo list. `/todos clear` empties it and tells the agent |
| `Ctrl+S` | Settings: icons, editor frame style, framed messages. With the editor frame off, use `/harness` |
| `/effort` | Pick how hard the model thinks |
| `/effort high` | Set it directly: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`. If the model can't use that level, Pi picks the closest one and you're told |

More detail is in [How it works](docs/how-it-works.md) and the [reference](docs/reference.md).

## Using it with other extensions

**`rpiv-todo`:** remove it if you have it, because both add a tool named `todo`.

**`pi-modes`:** version 0.6.0 or newer lets the agent use its todo list in `plan` and `read-only`. It takes over `Shift+Tab`, so the start card says `shift+tab mode`. To keep a key for effort, set `app.thinking.cycle` in `~/.pi/agent/keybindings.json`, or use `/effort`.

**`pi-sandbox`:** the bottom line shows `sandbox: on` or `sandbox: off` after the mode. Its longer status moves to `/sandbox`.

**`pi-router`:** the frame shows which model answered, such as `Auto → Haiku`.

**`pi-board`:** use `@huseynsnmz/pi-board`. The frame comes back when its board closes.

**`pi-cloak`:** no changes are needed. Tool boxes, `Alt+O` and the session file all show the masked text, and the automated run covers it.

**`pi-permission-system`, `pi-permission-classifier`:** no conflicts were found, and the automated run covers them together with `pi-modes`.

**`pi-claude-code-ui`:** it also draws tool calls, so list it above pi-suite in `packages`. `pi install` adds packages last, so this is the order you get if you install pi-frame second. Even then, it draws a call to a tool that doesn't exist outside pi-frame's box, so escape sequences in that call's arguments still reach the terminal. In the other order, or with `pi-claude-code-ui` alone, arguments of real tools leak too. To close this, remove `pi-claude-code-ui`.

## Security limits

- **This isn't a sandbox.** Use a container for repositories you don't trust.
- **It only cleans what it draws.** Pi draws assistant messages and some entries itself.
- **`gh` and `glab` still run in their repositories,** and they call `git` for reads such as the remote list.
- **`glab` needs a host with `gitlab` in its name.** It starts for that remote, and if a token is set in the environment (`GITLAB_TOKEN`), only for `gitlab.com` or `GITLAB_HOST`, because a repository picks its own remote.
- **The `git status` protections cover the ways to run code that I know of.** New Git options could add others.
- **The parts of `@adeildo/pi-kit` 6.0.0 that frame uses are copied into `src/kit`,** with its license, so upstream fixes have to be copied in by hand. Its settings stay in `~/.pi/agent/extensions/pi-harness/settings.json`.
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
