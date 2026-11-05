# subscription

Part of [pi-suite](../../README.md). Off until you run `/suite on subscription`.

Claude models in Pi on your Claude login, through Anthropic's Agent SDK. Pi keeps its own agent loop and tools. It asks before anything more is billed as extra usage.

**Read this first.** Anthropic's [legal page](https://code.claude.com/docs/en/legal-and-compliance) says subscription logins are for ordinary use of Claude Code and Anthropic's own apps, and that products built on the Agent SDK should use API keys. It doesn't address a personal extension like this one, and says Anthropic may enforce its rules without notice. This could stop working, and the risk is to your account. An [API key](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) is the clear-cut alternative.

## Use

1. Log in to Claude Code: `claude`, then `/login`.
2. Run `/suite on subscription`.
3. Pick a `claude-sdk/...` model in `/model`, such as `claude-sdk/claude-sonnet-5-5`.

It only uses Claude Code's login, and removes settings such as `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` from Claude Code's environment, so nothing else decides where your requests go.

## Extra usage

When Claude Code reports that requests are billed as extra usage, you choose:

- **No, stop:** nothing more is sent, and each new message asks again.
- **Yes, for this session:** it doesn't ask again until requests are back on your plan or a new session starts.

With nobody to ask, as in `pi -p` or an agent, the answer is no.

This isn't a hard limit:

- **The first request over the limit is billed**, as the report comes with the response. A tool loop can bill more. To be sure, leave extra usage off or set a monthly cap in your Claude settings.
- **It goes by what Claude Code reports.** It's been tested against a fake server, not a real bill, so check your usage page after your first requests.
- **The costs Pi shows are estimates** at API prices.

A request can also be refused with `Third-party apps now draw from your extra usage`. Nothing runs then, and the error says what to do.

## Settings

All optional, in `/suite` or under `subscription` in `~/.pi/agent/suite.json`:

```json
{ "subscription": { "pathToClaudeCodeExecutable": "/opt/homebrew/bin/claude", "maxSessions": 3, "idleMinutes": 20, "promptMode": "claude" } }
```

`PI_CLAUDE_SDK_CLAUDE_PATH` overrides the program, and `PI_CLAUDE_SDK_DEBUG=/path/log` logs how each request was routed.

## System prompt

These models get a prompt written for Claude that says it's working in Pi, and keeps Pi's tools, guidelines, context files and skills. Your own `SYSTEM.md` always wins.

They use Pi's default prompt instead with `router/auto`, in `plan` and `read-only`, and when memory or a playbook has something to add. Set **System prompt** to `pi` in `/suite` to always use Pi's. With Pi's prompt, expect the refusal above or the extra usage question more often.

## What it leaves behind

- **Session files:** conversations are copied to `~/.claude/projects`, readable only by you, so they can show in Claude Code's `/resume`. `~/.pi/agent/claude-sdk/anchors.jsonl` tracks where each one is.
- **A large dependency:** `@anthropic-ai/claude-agent-sdk` includes a Claude Code binary of about 270 MB, and installs the MCP SDK, `express` and `hono`, which nothing here loads.

## Credits

Based on [pi-claude-subscription](https://github.com/jkeskikangas/pi-claude-subscription) by Jarno Keskikangas, under the MIT license.
