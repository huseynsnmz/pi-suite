# frame

Part of [pi-suite](../../README.md). Turn it off with `/suite off frame`.

A redrawn screen for Pi. If you have `pi-look`, remove it, as both draw the same screen, and set your choices again with `Ctrl+S` under **Frame**.

## What you see

- **Start card:** the folder, branch and model, and what changed or waits on you since your last session there: conflicts, a branch behind, a failed CI run, a pull request. CI and requests use `gh` or `glab` if you have them.
- **Tool boxes:** each call's command, who allowed it, its output and how long it took. An edit shows the diff, with changed words highlighted.
- **Timings:** a line under each response with the wait, thinking time, total and speed. Turn it off under **Timings**.
- **Todo list:** a checklist above the editor for work with several steps. `/todos` shows it, and `/todos clear` empties it.
- **Editor frame:** branch, folder, model, effort and how full the context is. Its color follows the mode: yellow for `auto`, accent for `plan`, green for `read-only`, red for `yolo`.
- **Footer:** the mode, what other extensions report, then cost, tokens, cache and speeds.

## Keys

| Key | What it does |
|---|---|
| `Ctrl+C` | Stop a run. With nothing running, clear the editor, then press again to exit |
| `Ctrl+R` | Search what you've typed, here and in this folder's other sessions. `/name` renames instead |
| `Up` / `Down` | Past prompts. With one line typed, only those that start with it |
| `Ctrl+T` | Open or collapse finished reasoning |
| `Alt+O` | Scroll through tool output, one call at a time |
| `Ctrl+O` | Expand every call |
| `Ctrl+S` | Settings. With the editor frame off, use `/harness` |
| `/effort` or `/effort high` | How hard the model thinks |

On a Mac, `Alt` is the Option key, which needs setting up: Left Option as `Esc+` in iTerm2, `"terminal": { "option_as_meta": true }` in Zed, or "Use Option as Meta" in Terminal.app. In Ghostty or kitty, `Cmd+S` and `Cmd+O` work too.

To collapse reasoning once a message is done, set `"hideThinkingBlock": true` in `~/.pi/agent/settings.json`.

More in [How it works](docs/how-it-works.md) and the [reference](docs/reference.md).

## Using it with other extensions

- **`rpiv-todo`:** remove it, as both add a tool named `todo`.
- **`pi-claude-code-ui`:** it also draws tool calls, so list it above pi-suite in `packages`. Escape sequences in a call to a tool that doesn't exist can still reach the terminal. In the other order, arguments of real tools can too. To close this, remove it.
- **`pi-sandbox`:** the bottom line shows `sandbox: on` or `off`. The rest moves to `/sandbox`.
- **`pi-cloak`, `pi-permission-system`, `pi-permission-classifier`:** nothing to do.

## Security limits

- **This isn't a sandbox.** Use a container for repositories you don't trust.
- **It only cleans what it draws.** Pi draws assistant messages and some entries itself.
- **`gh`, `glab` and `git` still run in the repository.** The protections around `git status` cover the ways to run code that are known today. `glab` only starts for a host with `gitlab` in its name, and with a `GITLAB_TOKEN` set, only for `gitlab.com` or `GITLAB_HOST`.
- **Code from `@adeildo/pi-kit` is copied into `src/kit`,** so upstream fixes have to be copied in by hand.

## Credits

MIT. [LICENSE](LICENSE) keeps the original copyright notice. The design and most of the code come from [pi-look and pi-harness](https://github.com/felipeadeildo/pi-harness) by [adeildo](https://adeildo.dev). If you want the original, use that. The framed editor comes from [pi-open-tui](https://github.com/OldSuns/pi-open-tui) and the segments from [oh-my-pi](https://github.com/can1357/oh-my-pi), by way of pi-look.
