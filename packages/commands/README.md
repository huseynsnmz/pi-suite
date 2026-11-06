# commands

Part of [pi-suite](../../README.md). Turn it off with `/suite off commands`.

## `/clear`

Starts a new session and keeps your selected model and reasoning. `/new` goes back to your saved default instead. If the agent is working, it stops first. `/resume` brings the old session back.

## `/security-review`

Reviews your branch for security problems an attacker could really use. It covers commits since the default branch, staged and unstaged edits, and new files. Add a focus if you like: `/security-review focus on auth`.

- **It reads safely.** Git hooks and diff programs are off while it reads your changes, and it stops if the repository sets a git filter.
- **It doesn't lock the agent.** It asks the model not to change files, but your mode decides what it can do. Use `read-only` to be sure.
- **It goes to your current model,** like any other message. A diff over 200,000 characters is read a file at a time.
- **It's one model's judgment,** not a real audit.
