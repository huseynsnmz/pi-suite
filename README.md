# pi-suite

One package for [Pi](https://pi.dev): modes and permissions, a framed screen, a board of agent sessions, long-term memory, web tools with a separate page reader, and a model router. Everything is on until you turn it off.

| Part | What it adds | Details |
|---|---|---|
| `modes` | `plan`, `auto`, `read-only` and `yolo` modes, plan approval, and interviews with `ask_questions` | [README](packages/modes/README.md) |
| `router` | `router/auto`: one model to plan, another to build, and one each for the page reader, the judge and subagents | [README](packages/router/README.md) |
| `web` | `web_fetch` and `web_search`, with pages read by a separate model that has no tools | [README](packages/web/README.md) |
| `memory` | Memory the agent keeps between sessions | [README](packages/memory/README.md) |
| `frame` | The start card, framed editor, tool boxes, footer and the agent's todo list | [README](packages/frame/README.md) |
| `board` | A board for starting, watching and attaching to background sessions | [README](packages/board/README.md) |
| `commands` | `/clear` and `/security-review` | [README](packages/commands/README.md) |

## Install

Requires Pi 1.5 or newer.

```bash
pi install npm:@huseynsnmz/pi-suite@0.1.0
```

If you installed any of these separately, remove them first:

```bash
pi remove npm:@huseynsnmz/pi-board
pi remove npm:@huseynsnmz/pi-frame
pi remove npm:@huseynsnmz/pi-memory
pi remove npm:@huseynsnmz/pi-modes
pi remove npm:@huseynsnmz/pi-web
```

Pi won't start if two packages add a tool with the same name, and `/suite` can't help at that point. So if another package also has a `todo`, `web_fetch` or `memory_add` tool, or you get a conflict error, add the part to `~/.pi/agent/suite.json` by hand, or remove the other package.

Your settings carry over, since each part still reads its own config file.

If you use `@gotgenes/pi-permission-system`, move pi-suite above it in `packages` in `~/.pi/agent/settings.json`. `pi install` adds packages last, and otherwise you may be asked to approve an action that `plan` or `read-only` then blocks. With `pi-sandbox`, keep pi-suite first in `packages`, or `yolo` will refuse to start.

## Turning parts off

| Command | What it does |
|---|---|
| `/suite` | A list to turn parts on and off |
| `/suite list` | What's on now, and what changes after a reload |
| `/suite off board` | Turn one part off |
| `/suite on board` | Turn one part back on |

Changes apply after a reload, which `/suite` offers to do. They're saved in `~/.pi/agent/suite.json`, which you can also edit:

```json
{ "off": ["board", "web"] }
```

A part that's off isn't loaded at all, so it adds no tools, skills, prompts or start-up time. If the file has a mistake, everything stays on and Pi tells you, so a typo can't quietly turn off plan mode.

`modes` is treated differently, because it enforces plan and read-only:

- Turning it off asks first, and is refused where nobody can answer, as in `pi -p`.
- While it's off, every session says so.
- If it fails to load, Pi stops instead of running without it. Any other part that fails is reported, and the rest carry on.
- In `plan` and `read-only`, `todo`, `ask_questions`, `web_fetch` and `web_search` are only allowed from pi-suite itself, so another package's tools with those names are blocked there.

Parts work on their own and use each other when they're on. With `modes` off, for example, `router` only goes by the first edit. With `router` off, `web` reads pages with the session's model.

## Good to know

- **All parts share one version.** A fix to one part means a new version of the whole package.
- **Load order is per package.** Every part loads where pi-suite is listed in `packages`. `modes` wants that to be first, while `pi-claude-code-ui` has to be listed before `frame`, so they can't both get their way. If you use `pi-claude-code-ui`, see [frame's notes](packages/frame/README.md#using-it-with-other-extensions).
- **Pi counts it as one extension.** The start card lists `pi-suite` rather than each part.
- **`board` on Linux is untested.** It uses `node-pty`, which has no Linux build in its package and needs its install script. The rest of the suite should still load without it.

## Security limits

Each part has its own limits, listed in its README or `SECURITY.md`. None of this is a sandbox. Use a container for repositories you don't trust.

## Credits

`frame` started as a fork of [`@adeildo/pi-look`](https://github.com/felipeadeildo/pi-harness/tree/main/packages/look) by adeildo, and `board` as a fork of [`@zhuxixi/pi-agent-board`](https://github.com/zhuxixi/pi-agent-board). Their licenses are in each folder.

## Development

```bash
npm install --ignore-scripts
npm run check
npm test
npm run test:e2e
```

Each part keeps its own tests under `packages/<part>/test`. `frame` needs [bun](https://bun.sh) for its unit tests. `npm run test:e2e` drives real Pi in a real terminal with a fake model.
