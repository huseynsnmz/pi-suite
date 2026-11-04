# Security

## Reporting a vulnerability

Please don't open a public issue for a security problem. Use **Report a vulnerability** on the repository's Security tab, or email huseyin@snmz.org.

Examples that count as security problems:

- A command the read-only check accepts that can write files or run other code.
- A way for an agent or a repository to change the mode without the user.
- The permission judge running outside `auto` mode.

Fixes go into the latest release only.

## What this extension does not protect against

pi-modes keeps an honest agent on track and is not a sandbox. The limits are listed in the README under "Security limits". A problem that falls under one of those limits is a normal issue.
