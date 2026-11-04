# Security

## Reporting a vulnerability

Please don't open a public issue for a security problem. Use **Report a vulnerability** on the repository's Security tab, or email huseyin@snmz.org.

Examples that count as security problems:

- A reply or other input from the board that answers a permission prompt in a session.
- Output from a session that reaches your terminal as a command, or runs anything outside that session.
- Another local user reaching a session through the board's sockets or files.

Fixes go into the latest release only.

## What this extension does not protect against

- **What a session can do:** each one is a real Pi session with your access. Use your permission rules and sandbox.
- **Project files:** a trusted project's Pi settings apply to its sessions.
- **Secrets on screen:** anything printed in a session is saved in its session file and screen log.
