# memory

Part of [pi-suite](../../README.md). Turn it off with `/suite off memory`. Requires Node 22.18 or newer.

Two things that carry over between sessions: **memories**, which are facts, and a **playbook**, which is how to work.

## Memories

| Command | What it does |
| --- | --- |
| `/memory` | What applies in this folder, and how many sessions wait for a review |
| `/memory <words>` | Search everything |
| `/memory review` | Go through past conversations, one batch at a time |
| `/memory forget <id>` | Delete a memory |

Or just ask: "remember that I deploy from main".

A review proposes memories from your past conversations, and you choose which to keep. Each new session gets the newest ones for its folder, then global ones, up to 2,000 characters. The model can search for the rest.

A review batch costs up to about 15,000 tokens on your current model. Memories add up to about 500 tokens to every request.

## Playbook

| Command | What it does |
| --- | --- |
| `/mastermind` | A strong model reads past conversations and writes rules for your other models |
| `/mastermind compact` | Shortens the playbook, keeping what each rule means |
| `/mastermind show` | The rules in force in this folder |

First choose a model as `mastermind` in [`/router`](../router/README.md). It looks for what you corrected, mistakes that came back, and what the model should have read first.

- **It stays short.** Up to 1,000 characters globally and 1,000 per folder, rewritten to fit each time.
- **You approve every word** in an editor, and nothing is saved until you do. Secrets are refused.
- **Your session stays small.** What the strong model reads never enters your conversation.
- **It costs up to about 15,000 tokens a batch** on that model, and your conversations go to that provider. It never runs on its own, and Pi mentions it once 10 sessions are waiting.
- **Sessions stay unread if an answer is cut off**, so you can try again.

## Where it's kept

Memories are in `~/.pi/agent/memory/memory.db`, readable only by you. Playbooks are in `~/.pi/agent/memory/playbook/`, with the last version of each as `.bak`.

## Limits

- **Secrets:** text that looks like a key, token or password is removed before a review and refused when saving. That catches common formats, not all of them.
- **Prompt injection:** reviews read only what you and the model said, never tool output. Text the model repeated from a file can still get through, so read what you're asked to keep, especially the playbook, which is followed as instructions.
- **Your provider** sees past conversations during a review, and memories and the playbook on every request.
