# web

Part of [pi-suite](../../README.md). Turn it off with `/suite off web`.

Web fetch and search, built so the agent never reads the web.

A page can hold instructions aimed at the AI reading it. So a separate model with no tools reads every page and search result, and the agent only gets its answer. If that model isn't available, the page isn't read.

## Use

`web_fetch` works straight away. Pages are read by the session's model, unless you set one with `/web reader` or the `reader` role in [`/router`](../router/README.md). A small model costs less.

`web_search` stays off until you choose where searches go, because every search leaves your machine. Add one of these under `web` in `~/.pi/agent/suite.json`, and restart Pi:

```json
{ "web": { "searxngUrl": "http://localhost:8888" } }
```

Your own [SearXNG](https://docs.searxng.org) server needs no account, and passes searches on to the engines it uses. List `json` under `search.formats` in its `settings.yml`. Public servers almost always refuse this.

```json
{ "web": { "companySearch": true } }
```

markdown.new is free with no key, at 30 searches a minute and 500 a day. Your searches go to its operator, then Serper and Google.

`/web` shows what's in use. If the settings can't be read, the web tools stay off and Pi says why.

## Settings

| Setting | What it does |
| --- | --- |
| `provider` | `searxng` or `markdown.new`, if you've set up both |
| `readerModel` | The model that reads pages, as `provider/id` |
| `allowDomains` | Only these sites and their subdomains can be fetched |
| `denyDomains` | These sites and their subdomains can't be fetched |
| `trustedDomains` | Sites where the agent can write its own addresses without asking |
| `askNewDomains` | `true` asks before the first fetch from each site |
| `strictUrls` | `true` asks about every URL the agent wasn't given |
| `privateWords` | Words a search can never hold, such as client names |
| `minConfidence` | Withholds answers the reader scores below this, out of 10. Default 4 |
| `dnsFilter` | `cloudflare-family` (default), `cloudflare-security` or `off` |

## What it checks

**Before anything leaves**

- Queries and URLs that look like they hold a secret or a long encoded string are refused.
- The agent can fetch URLs you wrote and links from pages it was given. Writing its own address on a new site asks you once. So does an address with a query string, or more than 25 on one site. With nobody to ask, it's refused.
- Local and private addresses are refused, and checked again when connecting.
- A redirect to another host is reported, not followed.
- Site names go through Cloudflare's filtering DNS. If that can't answer, the page isn't fetched.

**Before the reader sees a page:** scripts, images, forms, invisible characters and hidden elements are removed.

**Before the agent sees an answer**

- Links that weren't in the page are removed.
- An answer that reads like instructions to an AI is withheld.
- The reader scores how well the page supports its answer. A page can fake this score, so it measures quality, not safety.

## Limits

- **A page can still lie.** It can fool the reader into a false answer, so treat answers as claims from a stranger.
- **Checks don't catch everything.** They're patterns, and text hidden by a stylesheet in another file gets through. A page about prompt injection may have its answer withheld.
- **A few plain words can still carry data out**, in a search or an address on a site you approved. A site you approve is trusted for the session. Project names need `privateWords`.
- **The site filter only knows Cloudflare's lists,** and every site name you fetch goes to Cloudflare.
- **The sandbox's domain list doesn't cover this**, as it runs inside Pi. Use `allowDomains` and `denyDomains`.
- **No JavaScript or PDFs**, and sites that block bots return an error.
- **No proxy.** `198.18.0.0/15` is refused, so a VPN that hands out those addresses blocks every fetch.

## Cost

Each fetch is one extra model call with up to 100,000 characters, and each search up to 40,000. The same question on the same page within 15 minutes isn't asked again.
