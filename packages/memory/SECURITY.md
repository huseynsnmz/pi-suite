# Security

## Reporting a vulnerability

Please don't open a public issue for a security problem. Use **Report a vulnerability** on the repository's Security tab, or email huseyin@snmz.org.

Examples that count as security problems:

- A way for a file, web page or tool output to get a memory saved without the user seeing it.
- A memory that reaches the system prompt with control characters in it, or read as anything but information.
- The database being readable by another local user.
- Text in the common secret formats reaching the store.

Fixes go into the latest release only.

## What this extension does not protect against

- **Secrets it doesn't recognize:** detection covers common formats, not every secret.
- **What you approve:** text the model repeated from a file can appear in a proposal, so read what you're asked to keep.
- **Your model provider:** a review sends past conversations to your current model, and recall sends memories with every request.
