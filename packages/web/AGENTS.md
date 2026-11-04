# AGENTS.md

`README.md` explains what this does. This file holds what the code can't tell you.

## Things that are easy to break

- Web text must never reach the agent: no raw mode, no fallback when the reader fails, and no page text in an error. `test/e2e/run.mjs` is what proves this, by recording every model request.
- The reader's confidence score is its own opinion, and a fooled reader can fake it. Never let a high score skip another check.
- The reader must have no tools. That's why a fooled reader can only spoil an answer.
- Search links go to the agent, so they're checked and listed without titles, which are web text.
- Nothing from a server goes in an error, including header values. Pi passes errors to the agent without the reader.
- `details.links` and user messages are what count as given, compared exactly. Never read them from any tool's text: any tool can echo, so the agent could approve its own URL, query string and all.
- `approveUrl` runs before any DNS lookup. Looking up a name the agent wrote is enough to send data in a subdomain to whoever runs that domain.
- `urlConcern` can't be airtight, as data can be made to look like anything, and an independent review got past it. What limits a leak is `approveUrl`: the agent only writes addresses on sites a person named or approved, and only so many. Never let `urlConcern` passing be enough on its own.
- `givenSites` counts sites you named and sites a search returned. Sites a page links to don't count, or a poisoned page could vouch for wherever it wants data sent.
- Settings are only read from the agent folder. A project's own file could send searches to its author.
- Company search stays behind `companySearch`, and a new company provider goes behind it too.
- A wrong setting turns the web tools off, as an allow list that quietly became empty would allow everything. The site filter fails closed. Bare IPs are refused while it's on, since they'd go around it.
- `publicLookup` checks addresses at connection time. A check before the request could be beaten by a name that changes what it resolves to.

## Testing

- `npm run check`, `npm test`, then `npm run test:e2e`, which runs real Pi with a fake model. It needs Node 22.18 or newer.
