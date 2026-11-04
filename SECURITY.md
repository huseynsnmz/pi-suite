# Security

Please report a vulnerability through [GitHub's private reporting](https://github.com/huseynsnmz/pi-web/security/advisories/new), not in a public issue.

These count as vulnerabilities:

- Web text reaching the agent without passing through the page reader
- The agent getting a URL it wrote past the fetch check with a query string or encoded data in it
- Reaching a local or private address
- Getting a blocked site past the site filter, or the site filter failing open
- A company receiving searches while `companySearch` is off

A page fooling the reader into a false answer doesn't count, as the README says this can't be prevented.
