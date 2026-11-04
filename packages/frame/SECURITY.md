# Security

## Reporting a vulnerability

Please don't open a public issue for a security problem. Use **Report a vulnerability** on the repository's Security tab, or email huseyin@snmz.org.

Examples that count as security problems:

- A repository that gets code to run through what pi-frame starts, such as `git status`.
- Text from a tool, a model or a repository that reaches the terminal as a command through something pi-frame draws.

Fixes go into the latest release only.

## What this extension does not protect against

pi-frame draws the screen and is not a sandbox. The limits are listed in the README under "Security limits". A problem that falls under one of those limits is a normal issue.
