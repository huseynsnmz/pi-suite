# Reference

## Main list

Typing goes straight into the input, as in Claude Code's agent view, so there's no mode to enter first.

| Key | Action |
| --- | --- |
| Any text | Start writing a task. |
| `Enter` | Start the task, or attach to the selected session when the input is empty. |
| `Ctrl+Enter` | Start the task and attach to it. |
| `Shift+Enter` / `Ctrl+J` | New line in the task. |
| `Ctrl+N` | While typing, choose the folder, model and thinking level first. |
| `Left` / `Right` | Attach to the selected session. |
| `Left` twice | From an empty Pi prompt, put this session on the board and open it. |
| `Up` / `Down` | Move between rows. |
| `PgUp` / `PgDn` | Move by a screenful. |
| `Home` / `End` | First or last row. |
| `Alt+Up` / `Alt+Down` | Previous or next group. |
| `Alt+1`..`Alt+9` | Attach to that row. |
| `Space` | Open or close Peek. |
| `/` / `Ctrl+F` | Filter the list. |
| `Ctrl+S` | Group by state or by directory. |
| `Shift+Up` / `Shift+Down` | Move the row up or down its group. |
| `Ctrl+G` | Write the task in `$VISUAL` or `$EDITOR`. |
| `Ctrl+T` | Pin or unpin. |
| `Ctrl+R` | Rename. |
| `Ctrl+X` | Stop the session; press again within 2 seconds to delete it. |
| `Ctrl+D` | Confirm marking an inactive session Done. |
| `Ctrl+B` | Hold or unhold an inactive session. |
| `Ctrl+A` | Select several rows. |
| `Ctrl+O` | Read-only transcript. |
| `Ctrl+E` | Evidence / Diagnostics. |
| `Ctrl+K` | Delete inactive rows in the selected state. |
| `!` | node-pty diagnostics and fix steps. |
| `?` | Help. |
| `Esc` | Clear a draft, or leave the board. |
| `Ctrl+C` | Clear a draft; press twice to leave. |

On macOS, the `Alt` keys need your terminal to send Option as Alt.


## Multi-select

Press `Ctrl+A` in the main list to act on several sessions at once.

| Key | Action |
| --- | --- |
| `Up` / `Down` / `j` / `k` | Move the selection. |
| `Space` | Toggle the current row. |
| `a` | Select all visible rows. |
| `u` | Clear the selection. |
| `d` | Confirm marking the selected inactive rows Done. |
| `Ctrl+X` | Delete the selected Done rows (confirmation prompt). |
| `m` / `Esc` / `Ctrl+C` | Leave multi-select mode. |
| `?` | Open the help overlay. |
| `!` | Open node-pty diagnostics and fix steps. |


## Peek

Peek shows the selected session's summary, blocker or question, latest output, and available issue/PR references.

| Key | Action |
| --- | --- |
| Any text | Start a reply, and press `Enter` to send it without attaching. |
| `Left` / `Right` | Attach to the session. |
| `Up` / `Down` | Move to the previous or next session. |
| `Ctrl+O` | Open the read-only transcript. |
| `Ctrl+E` | Open Evidence / Diagnostics. |
| `Ctrl+D` | Confirm marking the inactive session Done. |
| `Ctrl+B` | Hold or unhold the session. |
| `!` | Open node-pty diagnostics and fix steps. |
| `Space` / `Esc` | Return to the main list. |

When a Pi question or questionnaire tool is pending, inline reply is rejected; attach to answer that interactive question in the real Pi session.


## Transcript

The `v` view is a read-only projection of the durable Pi session JSONL. It does not interrupt a running worker.

| Key | Action |
| --- | --- |
| `Up` / `Down` / `j` / `k` | Scroll one line. |
| `PageUp` / `PageDown` | Scroll one page. |
| `Space` | Open Peek. |
| `r` | Enter reply mode. |
| `Enter` or `a` | Attach to the session. |
| `e` | Open Evidence / Diagnostics. |
| `d` | Confirm marking the inactive session Done. |
| `h` | Hold or unhold the session. |
| `!` | Open node-pty diagnostics and fix steps. |
| `Left` / `Esc` / `<` | Return to the main list. |


## Evidence / Diagnostics

The `e` view shows durable session evidence, including changed files, commands and their outcomes, command output previews, assistant evidence, errors, diagnostics, and artifact paths. Press `x` to clear diagnostics while preserving the evidence artifacts.

| Key | Action |
| --- | --- |
| `Up` / `Down` / `j` / `k` | Scroll one line. |
| `PageUp` / `PageDown` | Scroll one page. |
| `r` | Enter reply mode. |
| `v` | Open the read-only transcript. |
| `Enter`, `a`, `Right`, or `l` | Attach to the session. |
| `x` | Clear diagnostics; evidence is preserved. |
| `Left` / `Esc` / `<` | Return to the main list. |


## PTY attach

PTY attach opens the real interactive Pi session. `Ctrl+Left` detaches and returns to the board regardless of editor state, and `Ctrl+\` is the unconditional escape — a single raw ASCII byte (0x1c) that terminals forward unchanged in raw mode (kitty CSI-u and modifyOtherKeys encodings included), honored no matter what the child editor reports. `Left` detaches only while the child Pi reports an empty editor; while you are editing text — or when the child's editor state is unknown (e.g. the child extension is missing) — `Left` is forwarded to the Pi editor. A disconnected host can always be exited with `Left`. `Ctrl+]` is not a detach key — it is passed through to the child Pi editor. `Ctrl+\` caveats: on keyboard layouts where `\` sits on AltGr (e.g. German) the chord may never produce the byte — use `Ctrl+Left` there; in legacy keyboard modes `Ctrl+4` emits the same byte and also detaches; and the key is captured from the child while attached, so the child's own `Ctrl+\` binding (e.g. the vim terminal-mode prefix) is unavailable. While attached, `PageUp`, `PageDown`, `Home`, `End`, and the mouse wheel scroll local scrollback; whenever that viewport cannot move — the session holds the alternate screen (pi's fullscreen default), or there is no local history to travel — the wheel is forwarded to the session instead, which scrolls its own transcript: the same fallback the paging keys use. The attach viewport only scrolls scrollback the hosted session actually produced: rows that a snapshot hydration had to scroll out of the local window are not history, and the wheel is forwarded to the session instead of consuming those rows. Mouse drag or double-click selects and copies text, clicks open detected links, and middle-click paste is available on systems with the required X11 tooling. `Ctrl+X` opens an in-place delete confirm: press `y` (or Enter) to archive the row and return to the board with the next row selected — any other key cancels and is passed through to the session. While attached, the child Pi's own `Ctrl+X` bindings (copy in `/tree` and fullscreen, clear-all in the models dialog) are captured by this gesture.

Automatic light/dark themes work in attach sessions too. The child Pi's background-color probe (OSC 11) and its color-scheme change notification switch are forwarded to your real terminal; replies and notifications flow back to the child when your terminal answers — a terminal that never answers keeps the dark fallback. Attach also re-probes the background once when it settles, so the theme is correct from the first frame without re-selecting it in `/settings`. All of this is on by default; set `AGENT_BOARD_FORWARD_TERMINAL_QUERIES=0` to disable it. Not covered: keyboard-protocol negotiation (kitty flags / DA1) is not forwarded — the child negotiates once at spawn, before any attach client exists, and forwarding it would retune the shared real-terminal keyboard stack — so modifier-key encoding can still differ from a directly-run Pi (the modifyOtherKeys fallback applies).

The attach surface can forward terminal clipboard and image/file passthrough sequences. These behaviors can be disabled individually in [Configuration](#configuration). Cold hosts may briefly show a loading/reconnect surface while their PTY becomes ready.

## States, Grouping, and Filters

The board separates a session's semantic task state from whether a worker process is currently alive. An exited worker can therefore leave a durable row that is still resumable or attachable.

| Display state | Meaning |
| --- | --- |
| **Queued** | A run has been scheduled but has not started processing. |
| **Running** | The session is actively processing. |
| **Needs answer** | The session is waiting for user input or an answer to a question. |
| **Needs instructions** | The run ended without being marked complete and needs the next directive. |
| **On hold** | The user parked this session intentionally (manual verdict, `h` to toggle). Automated writers can't push it to Done; queued follow-ups do not wake it. |
| **Done** | The user marked the inactive session complete; this is the default completion path. |
| **Failed** | The worker or host ended with an error. |
| **Stopped** | The user stopped the active work. |

Rows are grouped by state. When a state contains sessions from multiple directories, rows are grouped by folder within that state. Pinned rows and folders come first, then creation order remains stable; activity does not reshuffle the list. New agent activity is marked unread with stronger row glyphs and header/footer counts. Replies sent while a session is busy enter a durable FIFO follow-up queue and are delivered when the session is ready; a `qN` badge shows queued follow-ups.

Press `/` to enter filter mode. Filter tokens are case-insensitive and can be combined with free-text terms:

```text
s:running
s:hold
review:ready
diag:stalled
evidence:error
queued:true
steer:awaiting-approval
```

- `s:<state>` matches a state prefix, including display-label aliases such as `needs-answer`.
- `review:ready` finds sessions with review-ready evidence.
- `evidence:error` finds sessions whose evidence contains errors.
- `queued:true` (also `yes` or `1`) finds sessions with queued follow-ups.
- `steer:<state>` filters by a persisted steering state.
- Bare words match name, summary, and working directory; multiple words use AND matching.

`diag:stalled` can consume persisted stalled diagnostics, but the current runner does not provide a general provider-stall detector. It should not be read as a complete automatic stall-detection feature.

## Evidence and Code References

Evidence is collected locally from session events. The board can extract issue and pull-request references from that evidence and show badges such as `#40` or `▸#45` on rows; Peek includes the provider, confidence, source, and URL when available. Built-in GitHub/GitLab-style providers are available, and an optional per-store `providers.json` can extend the provider rules. The `AGENT_BOARD_CODE_REFS=off` setting disables extraction.

For internal code platforms (non-github/gitlab hosts) or custom CLIs, add a per-store `providers.json` so claim/action rules exist and sessions stop depending on the low-confidence mention fallback. Example — an internal CLI (`acli`) with claim-strength issue rules:

```json
{
  "providers": [
    {
      "name": "acode",
      "hosts": ["acode.internal.example.com"],
      "rules": [
        { "pattern": "acli\\s+issue\\s+update\\s+#?(\\d+)(?=[\\s\\S]*--assignee)", "kind": "issue", "strength": "claim" },
        { "pattern": "acli\\s+issue\\s+(?:note|comment|close)\\s+#?(\\d+)", "kind": "issue", "strength": "action" },
        { "pattern": "acli\\s+issue\\s+(?:show|view)\\s+#?(\\d+)", "kind": "issue", "strength": "view" }
      ]
    }
  ]
}
```

`hosts` matches the repo's remote host; rules follow the same `pattern`/`kind`/`strength` shape as the built-in `gh`/`glab` tables (`strength`: `claim` > `action` > `view`), and the `#N` capture group supplies the number. Validation errors from a broken file surface in the diagnostics panel and never break extraction — an invalid file is simply ignored.

## Configuration

Settings live in `~/.pi/agent/extensions/pi-board/config.json`. Everything is optional, and a missing or broken file means the defaults. Restart Pi after editing it.

```json
{
  "model": "provider/model-id",
  "autoDone": false
}
```

### Helper model

Titles, row summaries and telling `Needs answer` from `Needs instructions` can use a model. **It's off by default**, so the board makes no model calls of its own and uses built-in rules instead.

Run `/board-model` inside Pi to pick a model or turn it off. It's saved to the file above and applies to sessions started from then on. These calls run through Pi, so any model Pi can use works, and they send up to 6,000 characters of a session's latest reply to that model.

### Other settings

| Key | Default | Purpose |
| --- | --- | --- |
| `model` | off | Helper model, as `provider/id`. |
| `groupBy` | `state` | `state` or `directory`. `Ctrl+S` changes it. |
| `root` | `~/.pi/agent/agent-board/` | Where the board stores its state. |
| `titleThinking` | `low` | Thinking level for titles. |
| `autoDone` | `false` | Let the helper model mark sessions Done. |
| `codeRefs` | `true` | Issue and pull request badges. |
| `disablePty` | `false` | Turn off live terminal sessions and attach. |
| `attachMouse` | `true` | Mouse handling in attached sessions. |
| `mouseScroll` | `true` | Mouse wheel scrolling in attached sessions. |
| `wheelLines` | `1` | Lines per wheel notch, from 1 to 50. |
| `maxWarmHosts` | `4` | Idle sessions kept ready for fast attach, from 0 to 50. |
| `warmHostTtlMs` | `600000` | How long an idle one is kept; `0` keeps it. |
| `nativePaste` | `true` | X11 PRIMARY copy and middle-click paste. |
| `forwardClipboard` | `true` | Forward OSC 52 clipboard writes from attached sessions. |
| `forwardImages` | `true` | Forward terminal images from attached sessions. |
| `imeFix` | `true` | IME cursor fix in attached sessions. |
| `terminalSnapshot` | `true` | Newer attach path; `false` uses the older one. |
| `replyGuard` | `true` | Discard stray terminal replies delivered as input. |

An `AGENT_BOARD_*` environment variable that's already set overrides the file for that run.

Setting `terminalSnapshot` to `false` routes attach onto the legacy fallback family: the screen.log replay tail plus the shrink-and-hold jiggle redraw. These paths exist only for pre-protocol runners and as a rollback hatch — they are not part of the snapshot+subscribe protocol path (issue #91 phase 4). They will be retired once the installed runner fleet is on the snapshot protocol baseline (detectable on the wire via hello protocol fields).

Older `AGENT_VIEW_*` names are still read in selected compatibility paths. Prefer `AGENT_BOARD_*` for new setups. Internal child markers are managed by the board and are not user settings.

The `providers.json` file under the configured store root can extend the built-in issue/PR reference providers; see the [Evidence and Code References](#evidence-and-code-references) section for the feature overview.

## Troubleshooting

### Rows stay in `Running`

First verify that Pi itself can complete a one-shot model call:

```bash
pi --mode json -p --no-session "Reply with exactly: DONE"
```

The command should emit an assistant reply, then an `agent_end` event, and exit. If it hangs before the assistant reply, fix Pi provider authentication or network access first. The board cannot produce live model results until Pi works independently.

### `node-pty unavailable`

Press `!` in the dashboard to open the diagnostic panel and follow its fix steps. Common causes include a missing native `node-pty` binary, a Node/architecture mismatch, a missing or non-executable macOS `spawn-helper`, or macOS quarantine. You can temporarily set `AGENT_BOARD_DISABLE_PTY=1` to use background JSON-runner behavior where supported.

### Attach is slow or keeps reconnecting

A cold PTY host may briefly show a loading or reconnecting surface while it starts. Check the PTY status in the dashboard with `!`; stale hosts are diagnosed separately from active task workers. If the host never becomes healthy, repair `node-pty` or use background mode for eligible managed sessions.

### IME candidate window is stuck at the window edge (Windows WezTerm)

On Windows WezTerm with a WSL2 backend, the IME candidate window may stay pinned to the right edge instead of following the text cursor in an attached session. Windows WezTerm only tracks the IME candidate position from the visible hardware cursor, and Pi hides the hardware cursor by default — the block cursor you see in the editor is drawn content, not the hardware cursor. Linux terminals are not affected.

Make the hardware cursor visible, either way:

```bash
export PI_HARDWARE_CURSOR=1    # machine-local, e.g. ~/.zshrc.local
```

or set `"showHardwareCursor": true` in Pi's `settings.json` (syncs across machines if the config is version-controlled; harmless on Linux).

Trade-off: the real terminal cursor becomes visible inside the TUI. This is cosmetic only.

### Start & attach falls back to background

Start & attach requires PTY support. When PTY is unavailable, the task is still dispatched in the background and the dashboard displays a warning. Repair PTY and retry attach from the normal `/agent-board` command path.

### Inline reply is rejected

A pending Pi question or questionnaire requires the real interactive session. Attach to the row and answer it there; ordinary replies can be sent from Peek and are queued while a session is busy.

### Sessions in the same repository conflict

Worktree isolation is not enabled. Stop overlapping writers, separate their working directories, or create and manage Git worktrees yourself before running concurrent coding tasks.


