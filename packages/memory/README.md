# pi-memory

Part of [pi-suite](../../README.md). Turn it off with `/suite off memory`.

Long-term memory for [Pi](https://pi.dev). It reviews your past conversations, keeps what will still matter in a SQLite file, and gives it to later sessions.

## Install

Requires Pi 1.5 or newer, on Node 22.18 or newer.

```bash
pi install npm:@huseynsnmz/pi-suite@0.2.1
```

## Use

| Command | What it does |
| --- | --- |
| `/memory` | What applies in this folder, and how many sessions are waiting for a review |
| `/memory <words>` | Search everything |
| `/memory review` | Go through past conversations, one batch at a time |
| `/memory forget <id>` | Delete a memory |

Or just ask: "remember that I deploy from main", "review our past conversations".

## How it works

- **Review:** the `review-memory` skill reads a batch of about 60,000 characters, proposes memories, and saves the ones you keep. It remembers how far it read in each session file, so a session you continue later gets read from where it stopped.
- **Recall:** each new session gets the newest memories for its folder, then global ones, up to 2,000 characters of system prompt. The model can search for the rest.
- **Scope:** a memory is global, or belongs to one folder.

## What it costs

A review sends the batch to your current model, up to about 15,000 tokens of input each. Recall adds up to about 500 tokens to every request in a session.

## Safety

- **Secrets:** text that looks like a key, token or password is removed before a review reads it, and refused when saving. This catches common formats, not every secret.
- **Prompt injection:** a review reads only what you and the model said, never tool output, and you see proposals before they're saved. Memories are marked in the system prompt as information, not instructions. Text the model repeated from a file can still get through, so read what you're asked to keep.
- **Permissions:** the database is only readable by you, at `~/.pi/agent/memory/memory.db`. The tools run inside Pi rather than through `bash`, so your permission rules see them by name.

## Contributing

Issues are welcome, and pull requests are turned off. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
