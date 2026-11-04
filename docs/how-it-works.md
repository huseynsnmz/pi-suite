# How it works

Every session on the board is a real Pi session, running in a terminal the board keeps open for it.

```text
/agent-board (a screen inside your Pi)
   │ start a task
   ▼
detached runner ──→ real `pi` in a hidden terminal (node-pty)
   │                 ├─ your extensions, permissions and session file
   │                 └─ keeps running after you close Pi
   ▼
~/.pi/agent/agent-board/ ──→ the board reads state from here
```

- **Starting a task:** a detached runner starts Pi at a saved session file, and types your task into it.
- **State:** the extension also loads inside each session, and reports what it's doing to a small coordinator process, which is the only writer of each row's state. The board reads that.
- **Waiting on you:** a permission prompt or other dialog takes the keyboard from Pi's prompt during a run, and that puts the row in `Needs answer`. A reply from Peek waits in the queue, because typing into the session would answer the dialog.
- **Attaching:** the board shows the session's real terminal inside your Pi, and hands the keyboard over until you detach.
- **The session you're in:** pressing `Left` twice adds its session file as a row. Pi keeps running it, so the board never starts a second Pi on that file.
- **Without node-pty:** tasks run with `pi --mode json -p`, where nothing can answer a prompt, and you can't attach.

## What it costs

The board makes no model calls of its own unless you choose a helper model with `/board-model`. See the [reference](reference.md#helper-model).

## What it doesn't do

- **Isolate sessions:** sessions in one repository share its working tree, so they can overwrite each other. Use your own worktrees for parallel changes.
- **Sandbox anything:** each session has what any Pi session has, with your extensions and permissions.
- **Protect what's on screen:** session files and a replayable screen log are stored as plain files, so a secret printed in a terminal gets saved.
