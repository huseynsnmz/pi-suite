# pi-subscription

Claude models in Pi on your Claude login, through Anthropic's Agent SDK. Pi keeps its own agent loop, tools, sessions and compaction, and Claude Code only carries the requests. It asks before anything is billed as extra usage.

Based on [pi-claude-subscription](https://github.com/jkeskikangas/pi-claude-subscription) by Jarno Keskikangas, used under the MIT license.

## Use it

This part is off until you run `/suite on subscription`, because its models count as logged in whether you are or not, and because of the terms below. Log in to Claude Code (`claude`, then `/login`), then pick a `claude-sdk/...` model in `/model`, such as `claude-sdk/claude-sonnet-5-5`. `/suite off subscription` removes them and moves you to another model.

It uses Claude Code's login, never Pi's. So that nothing else decides where your requests or login go, it removes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS` and the Bedrock, Vertex and Foundry switches from Claude Code's environment.

## Extra usage

When Claude Code reports that requests are billed as extra usage, you're asked before going on:

- **No, stop:** nothing more is sent, and each new message asks again, until the limit resets or a new session starts.
- **Yes, bill extra usage for this session:** it goes on, and doesn't ask again until requests are back on your plan, or a new session starts, including `/new`, `/clear` and `/reload`.

The report normally comes after the reply, so that reply is kept and the next request asks before sending anything. If a report arrives while a reply is being written, the reply is stopped. After a yes it runs again if nothing had appeared, and otherwise you send your message again.

With nobody to ask, as in `pi -p` or a subagent, the answer is no.

What this can't do:

- **The first request over the limit is billed.** Claude Code only reports billing with a response, and in testing that report came after the whole reply, including a slow one. So one reply can be billed before you're asked, or more if a tool loop has requests in flight. Your Claude settings are the hard limit: leave extra usage off, or set a monthly cap, if that matters.
- **It goes by what Claude Code reports.** It's been tested with the real Claude Code binary against a fake server that sends those reports, not with a real bill. Check your usage page after your first requests.
- **The costs Pi shows are estimates** at API prices, not what your plan charges.

A request can also be refused with `Third-party apps now draw from your extra usage`. Nothing runs then, and the error says what to do.

## Terms

Anthropic's [legal page](https://code.claude.com/docs/en/legal-and-compliance) says subscription logins are for ordinary use of Claude Code and Anthropic's own apps, and that products built on the Agent SDK should use API keys. It doesn't address a personal extension like this one, and it says Anthropic may enforce its rules without notice. So this could stop working, and the risk is to your account. An [API key](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) is the clear-cut alternative.

## System prompt

For `claude-sdk` models, Pi's default prompt is replaced by one written for Claude. It says it's working in Pi, and keeps every tool and guideline from Pi and other extensions, along with context files, skills and the working directory. Your own `SYSTEM.md` always wins.

Requests use Pi's default prompt instead with `router/auto`, in `plan` and `read-only` modes, and when the memory part has notes to add, because those build on Pi's prompt.

Anthropic's billing has been seen to depend on the prompt: upstream saw Pi's default prompt refused where this one ran on the plan. So expect the refusal above, or the question about extra usage, in those cases. To always use Pi's prompt, set `"promptMode": "pi"` in `claude-sdk.json`, or `PI_CLAUDE_SDK_PROMPT=pi`.

## Settings

`~/.pi/agent/claude-sdk.json`, all optional:

```json
{ "pathToClaudeCodeExecutable": "/opt/homebrew/bin/claude", "maxSessions": 3, "idleMinutes": 20, "promptMode": "claude" }
```

There's no setting per project, so a repository can't choose which program runs. `PI_CLAUDE_SDK_CLAUDE_PATH` overrides the executable, and `PI_CLAUDE_SDK_DEBUG=/path/log` writes how each request was routed.

## What it leaves on disk

Conversations are copied into Claude Code's session files under `~/.claude/projects`, readable only by you, so they can show up in Claude Code's `/resume`. `~/.pi/agent/claude-sdk/anchors.jsonl` records where each conversation is in those files.

## Dependencies

It needs `@anthropic-ai/claude-agent-sdk`, pinned to an exact version and loaded only on the first request to one of these models. That package includes a Claude Code binary of about 270 MB for your platform. npm also installs what it lists as required, including the MCP SDK and through it `express` and `hono`. Nothing here loads those: this part has its own small tool server, and the Agent SDK bundles its own copy.
