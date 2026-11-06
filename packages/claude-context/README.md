# claude-context

Part of [pi-suite](../../README.md). Turn it off with `/suite off claude-context`.

Requests to Claude models also get your Claude Code instructions, so Claude follows the same rules in Pi as in Claude Code. Other models don't get them.

## What it adds

Before each message to a Claude model, in this order and each file once:

1. `~/.claude/CLAUDE.md`
2. The files it imports with `@path`, such as `@rules` or `@rules/go.md`, up to 5 levels deep. A folder means the `.md` files in it.
3. The `.md` files in `~/.claude/rules`, as Claude Code loads them.

Pi's own files apply to every model as before: `~/.pi/agent/AGENTS.md`, `~/.pi/agent/APPEND_SYSTEM.md` and the project's. A file Pi already loads, such as a `~/.pi/agent/CLAUDE.md` that links to the same file, isn't added twice.

The files are read again for every message, so an edit applies from the next one.

## Which models

Claude through `anthropic`, the [subscription](../subscription/README.md) part's `claude-sdk`, and any provider whose model ID names Claude, such as Bedrock's `anthropic.claude-…`.

## Limits

- **Only global files.** Project `CLAUDE.md` files are Pi's to load, and a repository can't add to these.
- **`router/auto` gets nothing,** because which model answers is decided after this runs. Pick the Claude model in `/model` to use it.
- **Rules with `paths:` are left out,** since they apply only to some files, and which files isn't known before the message.
- **Imports in code** (code blocks and `code spans`) are ignored, as in Claude Code. Text that only looks like an import, such as a name after `@`, is ignored unless the file exists.
