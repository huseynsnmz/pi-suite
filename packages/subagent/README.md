# subagent

Part of [pi-suite](../../README.md). Turn it off with `/suite off subagent`.

One tool, `agent`, that hands a task to a fresh copy of Pi and gets its final answer back. Wide searches, heavy reading and independent reviews happen in its context rather than yours. There's nothing to set up, and no agents to define.

| `type` | What it can do |
| --- | --- |
| `explore` (default) | Only `read`, `grep`, `find` and `ls`. Works in every mode |
| `general` | Everything, under your permission rules. Blocked in `plan` and `read-only` |

Several calls in one message run at once.

- **Model:** the session's model and reasoning. With `router/auto`, that's the `subagent` role in [`/router`](../router/README.md), so a cheaper model can do the reading.
- **Mode:** it runs in your session's mode, except that `plan` becomes `read-only` and `yolo` becomes `normal`.
- **Permissions:** its asks come to your session.
- **Limits:** it can't start its own agents, it isn't saved as a session, and its answer is cut at 30,000 characters.

For long work in the background, use [board](../board/README.md). If you have `pi-subagents`, remove it, or the model has two tools for the same job.
