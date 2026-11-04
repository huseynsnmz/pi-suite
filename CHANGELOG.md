# Changelog

## [0.1.1] - 2026-11-04

### Features

- **reader**: `/web reader` picks the page reader from your models, saves it to `web.json`, and applies it straight away

## [0.1.0] - 2026-11-04

### Features

- **web_fetch**: finds something out from a page. A separate model with no tools reads it, and the agent only gets the answer
- **web_search**: searches through your own SearXNG server, or `markdown.new` if `companySearch` is on. It's off until you choose one
- **confidence**: the reader scores its answer from 1 to 10, and an answer below `minConfidence` is withheld
- **site filter**: Cloudflare's filtering DNS blocks known malware and adult sites before a fetch. It can be set to malware only, or off

### Security

- The agent can only fetch URLs you wrote or these tools returned, matched exactly
- Queries holding secrets, paths, email addresses, encoded text or your `privateWords` are refused
- Local and private addresses are refused, and checked again when connecting
- A wrong setting in `web.json` turns the web tools off
