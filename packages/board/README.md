# board

Part of [pi-suite](../../README.md). Turn it off with `/suite off board`.

Start a task and keep working. The board shows which background sessions need you, lets you peek and reply, and attaches when you want the whole conversation.

```text
╭─ π-board ───────────────────────────────────── node-pty healthy · hosts:2 ─╮
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

## Use

1. Press `Left` twice on an empty prompt, or run `/agent-board`.
2. Type a task and press `Enter`. It starts in the selected session's folder, with this session's model.
3. Press `Esc` to go back.

## Keys

| Key | What it does |
| --- | --- |
| `Enter` | Start the task, or attach to the selected session |
| `Left` / `Right` | Attach to the selected session |
| `Ctrl+\` | Back to the board from a session |
| `Space` | Peek at a session, and type there to reply |
| `/` | Pi's commands. Templates and skills start a session |
| `Ctrl+N` | While typing, choose the folder, model and thinking level |
| `Ctrl+F` | Filter |
| `Ctrl+X` | Stop a session. Press again within 2 seconds to delete it |
| `Ctrl+C` twice | Quit Pi. Sessions keep running |
| `Ctrl+Z` | Put Pi in the background, and `fg` brings it back |
| `!` | `node-pty` diagnostics |
| `?` | All the keys |

More in [How it works](docs/how-it-works.md) and the [reference](docs/reference.md).

## Settings

They're in `~/.pi/agent/extensions/pi-board/config.json`.

Built-in rules work out what state a session is in. To use a model for titles, summaries and state, run `/board-model`. That's off by default, costs tokens, and sends up to 6,000 characters of a session's latest reply to that model.

## Good to know

- **Sessions outlive Pi.** Closing Pi leaves them running. Idle ones are only cleaned up by a timer or the next board activity.
- **Sessions share files.** There are no worktrees, so give each session that writes its own.
- **Answer prompts by attaching.** A session waiting on a permission prompt shows `Needs answer`. A reply from Peek only waits in its queue.
- **It's all on disk.** Sessions and a screen log are plain files under `~/.pi/agent/agent-board/`, so anything printed is saved there.
- **It runs `node-pty`'s install script** when installed, for its terminal support.

## Credits

MIT. [LICENSE](LICENSE) keeps the original copyright notice. The design and most of the code come from [pi-agent-board](https://github.com/zhuxixi/pi-agent-board) by zhuxixi and its contributors. The keys and layout follow [Claude Code's agent view](https://code.claude.com/docs/en/agent-view).
