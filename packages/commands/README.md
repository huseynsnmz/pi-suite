# commands

Two commands for Pi. Part of [pi-suite](../../README.md); turn them off with `/suite off commands`.

## /clear

Clears the conversation and starts a new session, as `/new` does. If the agent is working, it stops first. The old session is kept, and `/resume` brings it back.

## /security-review

Reviews your changes for security problems the code could really be attacked through. It compares against where your branch left the default branch, so it covers commits, staged and unstaged edits, and new files. Text after the command goes to the model, as in `/security-review focus on auth`.

The screen shows one line, and the diff goes to the model. A diff over 200,000 characters is replaced by a summary, and the model reads it a file at a time.

**Limits:**

- It asks the model not to change files, but the current mode decides what it can do. Use `read-only` to be sure, especially on a repository you don't trust.
- The review is sent to your current model, like any other message.
- It's one model's judgment, so it can miss things and isn't a replacement for a real audit.
