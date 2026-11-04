# pi-web

Web search and fetch for [Pi](https://pi.dev), built so that the agent never reads the web.

A web page can hold instructions aimed at the AI reading it. So a separate model with no tools reads every page and search result, and the agent only gets its answer. If that model isn't available, the page isn't read.

## Install

```bash
pi install npm:@huseynsnmz/pi-web@0.1.0
```

`web_fetch` works straight away. It reads pages with the session's model, unless you set `readerModel`. `web_search` stays off until you choose where searches go.

## Search

Everything you search for leaves your machine, so nothing is chosen for you. Settings go in `~/.pi/agent/web.json`, and are read when Pi starts.

**Your own SearXNG server** needs no account, but it does pass your searches on to the search engines it uses:

```json
{ "searxngUrl": "http://localhost:8888" }
```

SearXNG only answers in JSON if you list it under `search.formats` in its `settings.yml`. Public SearXNG servers almost always refuse this.

**markdown.new** is free and needs no key: 30 searches a minute and 500 a day for your IP, with a shared cap across everyone using it. Your searches go to its operator, then Serper and Google. This is behind a flag:

```json
{ "companySearch": true }
```

## Settings

| Setting | What it does |
| --- | --- |
| `companySearch` | Allows searching through a company's service. Off by default |
| `provider` | `searxng` or `markdown.new`, if you've set up both |
| `searxngUrl` | Your SearXNG server |
| `readerModel` | The model that reads pages, as `provider/id`. A small one costs less. Defaults to the session's model |
| `allowDomains` | If set, only these domains and their subdomains can be fetched |
| `denyDomains` | These domains and their subdomains can't be fetched |
| `dnsFilter` | `cloudflare-family` blocks malware and adult sites, and is the default. `cloudflare-security` blocks malware only. `off` turns it off |
| `privateWords` | Words a search can never hold, such as client or project names |
| `minConfidence` | Answers the reader scores below this, out of 10, are withheld. Defaults to 4 |
| `askNewDomains` | Set to `true` to be asked before the first fetch from each site |

`/web` shows what's in use. If `web.json` can't be read or has a wrong value, the web tools stay off and Pi says why.

## What it checks

**Before anything leaves:**

- A query or URL that looks like it holds a secret is refused, as is a query holding a long encoded string.
- The agent can only fetch URLs that you wrote, or that `web_search` and `web_fetch` returned, matched exactly. So it can't write one with data in it. A link it found by reading a file has to come from you.
- Local and private addresses are refused, checked again at connection time, so a public name can't point at your network.
- A redirect to another host is reported, not followed. Fetching it goes through the same checks.
- Each site's name is checked with Cloudflare's filtering DNS before it's fetched. If the filter can't answer, the page isn't fetched. With the filter on, bare IP addresses are refused, as they have no name to check.

**Before the reader sees a page:** scripts, images, forms, invisible characters, and elements hidden in the page or its own stylesheets are removed.

**Before the agent sees an answer:**

- The reader scores from 1 to 10 how well the page supports its answer, and the agent sees the score. Below `minConfidence` the answer is withheld. A page that fools the reader can fake this score, so it's a measure of quality, not safety.
- Links that weren't in the page are removed.
- An answer that reads like instructions to an AI is withheld.
- If the page itself holds such wording, the agent is told.

## What it can't do

- It can't stop a page lying. A page can still fool the reader into a false answer, so treat answers as claims from a stranger.
- It can't catch every attack. The wording checks are patterns, and text hidden by a stylesheet in another file isn't noticed. A page about prompt injection may also get its answer withheld.
- The site filter only knows the sites on Cloudflare's lists. It says nothing about a new or unlisted site, and every site name you fetch goes to Cloudflare.
- It can't stop every way of carrying data out in a search. The query checks catch secrets, paths and encoded text, but a few plain words can still say something.
- It can't tell a private word in a query from an ordinary one unless it's in `privateWords`, so the agent could still search for a project's name.
- The sandbox's domain list doesn't cover it, as it runs inside Pi. Use `allowDomains` and `denyDomains`.
- It doesn't run JavaScript or read PDFs, and sites that block bots return an error.
- It doesn't use a proxy, and it refuses `198.18.0.0/15`, so a VPN that hands out those addresses will block every fetch.

## Cost

Each `web_fetch` is one extra model call with up to 100,000 characters of web text, and each `web_search` one with up to 40,000. The same question on the same page within 15 minutes isn't asked again. Set `readerModel` to something small to keep the rest down.
