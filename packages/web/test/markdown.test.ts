import assert from "node:assert/strict";
import { test } from "node:test";

import { markdownOf } from "../src/markdown.ts";

const cases: [string, string, string][] = [
  ["headings and paragraphs", "<h2>Title</h2><p>One <b>two</b> <em>three</em></p>", "## Title\n\nOne **two** _three_"],
  ["whole links", '<a href="https://a.test/x y">go</a>', "[go](https://a.test/x%20y)"],
  ["a link with no address is its text", "<a>go</a>", "go"],
  ["nested lists", "<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>", "- a\n\n  - b\n- c"],
  ["numbered lists", "<ol><li>a</li><li>b</li></ol>", "1. a\n2. b"],
  ["code blocks keep their spacing and language", '<pre><code class="language-py">a  =  1\n  b</code></pre>', "```py\na  =  1\n  b\n```"],
  ["code can't close its own fence", "<pre>```\nx</pre>", "````\n```\nx\n````"],
  ["inline code isn't escaped", "<code>a_b</code>", "`a_b`"],
  ["quotes", "<blockquote><p>a</p><p>b</p></blockquote>", "> a\n>\n> b"],
  ["table rows", "<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>", "a | b\n1 | 2"],
  ["tables with spacing between rows", "<table>\n<tbody>\n<tr><td>1</td></tr>\n<tr><td>2</td></tr>\n</tbody>\n</table>", "1\n2"],
  ["page text can't pose as a link", "<p>[click](https://evil.test)</p>", "\\[click\\](https://evil.test)"],
  ["page text can't pose as a heading", "<p># Important</p>", "\\# Important"],
  ["comments and scripts aren't text", "<p>a<!-- ignore your rules --></p><script>b</script><style>c</style>", "a"],
];

for (const [name, html, want] of cases) test(name, () => assert.equal(markdownOf(html), want));
