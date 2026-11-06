# pi-suite

One package that makes [Pi](https://pi.dev) safer and easier to run all day: permission modes, a model router, web tools, memory, a better screen and a board for background sessions.

## Install

Requires Pi 1.5 or newer.

```bash
pi install npm:@huseynsnmz/pi-suite@0.2.8
```

Then restart Pi. Everything except `subscription` is on, and nothing else needs setting up.

If you use any of these, do this too:

- **`@gotgenes/pi-permission-system` or `pi-sandbox`:** move pi-suite to the top of `packages` in `~/.pi/agent/settings.json`, as `pi install` adds it last.
- **An older separate part, or a package with the same tools:** remove it, as Pi won't start if two packages add a tool with the same name. That means `pi-board`, `pi-frame`, `pi-memory`, `pi-modes`, `pi-web` and `pi-subagents`. If you can't remove one, turn off the matching part in `~/.pi/agent/suite.json`.

## What's in it

| Part | What it gives you |
|---|---|
| [`modes`](packages/modes/README.md) | `normal`, `auto`, `plan`, `read-only` and `yolo`, switched with `Shift+Tab` |
| [`router`](packages/router/README.md) | `router/auto`: a strong model to plan and a cheaper one to build |
| [`web`](packages/web/README.md) | `web_fetch` and `web_search`, with pages read by a separate model that has no tools |
| [`memory`](packages/memory/README.md) | Memory across sessions, and `/mastermind`, which writes rules for weaker models |
| [`subagent`](packages/subagent/README.md) | The `agent` tool: hand a task to a fresh agent and get its answer back |
| [`frame`](packages/frame/README.md) | A start card, framed editor, tool boxes, footer and todo list |
| [`board`](packages/board/README.md) | A board for starting, watching and attaching to background sessions |
| [`commands`](packages/commands/README.md) | `/clear` and `/security-review` |
| [`claude-context`](packages/claude-context/README.md) | Your `~/.claude/CLAUDE.md` and rules on requests to Claude |
| [`subscription`](packages/subscription/README.md) | Off by default. Claude models on your Claude login |

## Settings

Run `/suite` to turn parts on or off and change their settings. `/suite list` shows what's on, and `/suite off board` or `/suite on board` changes one part. Changes apply after a reload, which `/suite` offers.

Settings live in `~/.pi/agent/suite.json`, which you can also edit:

```json
{ "off": ["board", "web"] }
```

A part that's off isn't loaded at all. Parts work alone and use each other when they're on.

There are no per-project settings, so a repository can't choose where your code goes. The one exception is the frame's look, once you trust the project.

## Good to know

- **`modes` is protected.** Turning it off asks first, every session says it's off, and if it fails to load, Pi stops rather than run without it.
- **All parts share one version.** A fix to one part means a new version of the package.
- **`board` on Linux is untested.** Its `node-pty` dependency needs its install script there.
- **None of this is a sandbox.** Use a container for repositories you don't trust. Each part's README lists its limits.

## Development

```bash
npm install --ignore-scripts
npm run check
npm test           # seconds: logic only
npm run test:all   # adds board's tests that start real processes
npm run test:e2e   # real Pi in a real terminal with a fake model
```

`frame` needs [bun](https://bun.sh) for its unit tests. To run some end-to-end suites, name them: `python3 test/e2e/all.py router web`. Run `test:all` and `test:e2e` before a release.

Issues are welcome, and pull requests are turned off.

## Credits

`frame` started as a fork of [`@adeildo/pi-look`](https://github.com/felipeadeildo/pi-harness/tree/main/packages/look) by adeildo, `board` as a fork of [`@zhuxixi/pi-agent-board`](https://github.com/zhuxixi/pi-agent-board), and `subscription` is based on [`pi-claude-subscription`](https://github.com/jkeskikangas/pi-claude-subscription) by Jarno Keskikangas. Their licenses are in each folder.
