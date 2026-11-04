# pi-board

Part of [pi-suite](../../README.md). Turn it off with `/suite off board`.

A board for [Pi](https://pi.dev)'s background sessions: start a task and keep working, see which sessions need you, peek at them, reply, and attach when you want the whole conversation. The keys follow Claude Code's agent view.

It started as a fork of [`@zhuxixi/pi-agent-board`](https://github.com/zhuxixi/pi-agent-board) 0.13.1, so the design and most of the code are theirs, under the MIT license.

```text
╭─ π-board 0.16.0 ────────────────────────────── node-pty healthy · hosts:2 ─╮
│ 1 needs answer · 1 running · •1 unread · 0 done                            │
╰────────────────────────────────────────────────────────────────────────────╯
◇ NEEDS ANSWER 1 ─────────────────────────────────────────────────────────────
 ›◆ fix the login test     my-app       Waiting on a prompt                 2m
● RUNNING 1 ──────────────────────────────────────────────────────────────────
  ● update the changelog   my-app       Running git log                    12s
╭─ new session ──────────────────────────────────────────────────────────────╮
│ › type a task to start a session                                           │
╰─ enter resume   space peek   ctrl+f filter   ctrl+x stop   ? keys ─────────╯
```

## Quick start

Requires Pi 1.5 or newer.

1. Install it:

   ```bash
   pi install npm:@huseynsnmz/pi-suite@0.2.2
   ```

2. Restart Pi, and press `Left` twice on an empty prompt, or run `/agent-board`.
3. Type a task and press `Enter`. It starts right away in the selected session's folder, shown on the input's title, with this session's model. With no sessions, that's this folder.

Your current session becomes a row too, even with no messages yet. `Esc`, or `Enter` on its row, brings you back to it.

Installing it runs `node-pty`'s install script, which sets up its terminal support.

## Keys

| Key | Action |
| --- | --- |
| Any text | Start writing a task |
| `Enter` | Start the task, or attach to the selected session |
| `Left` / `Right` | Attach to the selected session |
| `Ctrl+\` | Back to the board from a session. `Left` also works on an empty prompt |
| `Space` | Peek at a session, and type there to reply |
| `/` | Pi's commands, as at the prompt. Templates and skills start a session |
| `Ctrl+F` | Filter |
| `Ctrl+X` | Stop a session, and press again within 2 seconds to delete it |
| `Ctrl+N` | While typing, choose the folder, model and thinking level |
| `!` | `node-pty` diagnostics |
| `?` | All the keys |
| `Esc` | Clear the input, or leave the board |
| `Ctrl+C` twice | Quit Pi, from the board or a session. Sessions keep running |
| `Ctrl+Z` | Put Pi in the background, from the board or a session, and `fg` brings it back. Sessions keep running |

The full list is in the [reference](docs/reference.md).

## Settings

Settings live in `~/.pi/agent/extensions/pi-board/config.json`.

The board can use a model for titles, row summaries and working out what state a session is in. That's **off by default**, and built-in rules do the job instead. To choose a model, run `/board-model`. Helper calls cost tokens, and send up to 6,000 characters of a session's latest reply to that model.

## Good to know

- **No worktrees:** sessions in one repository share its files, so give each writer its own worktree.
- **Sessions outlive Pi:** closing Pi leaves them running. That's the point, but idle ones are only cleaned up by a timer or the next board activity.
- **Answering prompts:** a session waiting on a permission prompt shows `Needs answer`, and you attach to answer it. A reply from Peek waits in the queue.
- **Saved to disk:** sessions and a screen log are plain files under `~/.pi/agent/agent-board/`.

More detail is in [How it works](docs/how-it-works.md) and the [reference](docs/reference.md).

## `pi-frame`

[`pi-frame`](https://github.com/huseynsnmz/pi-suite/tree/main/packages/frame) 0.3.8 or newer draws its header and footer again when the board closes.

## Contributing

Issues are welcome, and pull requests are turned off. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Credits and license

MIT. See [LICENSE](LICENSE), which keeps the original copyright notice.

- [pi-agent-board](https://github.com/zhuxixi/pi-agent-board) by zhuxixi and its contributors
- The keys and layout follow [Claude Code's agent view](https://code.claude.com/docs/en/agent-view).
