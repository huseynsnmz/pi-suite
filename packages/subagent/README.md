# pi-subagent

Part of [pi-suite](../../README.md). Turn it off with `/suite off subagent`.

One tool, `agent`, that hands a task to a fresh copy of Pi and gives back its final answer as text. Wide searches, heavy reading and independent reviews happen in their context rather than yours. There's nothing to set up, and no agents to define.

| `type` | What it can do |
| --- | --- |
| `explore` (the default) | Only `read`, `grep`, `find` and `ls`. Also allowed in `plan` and `read-only` |
| `general` | Everything, under your permission rules. Blocked in `plan` and `read-only` |

- **Parallel:** several calls in one message run at once.
- **Model:** it uses the session's model and reasoning. With `router/auto`, that's the `subagent` role in `/router`, so a cheaper model can do the reading.
- **Permissions:** a child's asks come to your session, and `auto` carries over to it.
- **Limits:** a child can't start its own agents, its answer is cut at 30,000 characters, it isn't saved as a session, and it starts as fast as Pi does. For long work in the background, use [pi-board](../board/README.md).

If you have `pi-subagents` installed, remove it, or the model has two tools for the same job.
