/** Page HTML to Markdown. The page is hostile, so this only ever emits text, and escapes what would read as Markdown. */
import { parseHTML } from "linkedom";

interface DomNode {
  nodeType: number;
  tagName?: string;
  textContent: string | null;
  childNodes: Iterable<DomNode>;
  getAttribute?(name: string): string | null;
}

const TEXT = 3;
const ELEMENT = 1;
const NEVER = new Set(["script", "style", "noscript", "template", "head", "title", "meta", "link", "iframe", "object", "embed", "svg", "canvas", "form", "input", "textarea", "select", "button", "img", "picture", "video", "audio"]);
const BLOCK = new Set(["p", "div", "section", "article", "main", "aside", "header", "footer", "nav", "figure", "figcaption", "address", "details", "summary", "dl", "dt", "dd", "center"]);

function escaped(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/[*`[\]_]/g, "\\$&")
    .replace(/^(\s*)([-+=>]|#{1,6}(?=\s)|~~~)/, "$1\\$2")
    .replace(/^(\s*\d+)\./, "$1\\.");
}

/** Text with backticks in it needs a longer run of them around it. */
function fenceFor(text: string, shortest: number): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
  return "`".repeat(Math.max(shortest, longest + 1));
}

function inside(node: DomNode): string {
  return [...node.childNodes].map(render).join("");
}

function list(node: DomNode, ordered: boolean): string {
  let number = 0;
  const items = [...node.childNodes]
    .filter((child) => child.tagName?.toLowerCase() === "li")
    .map((item) => {
      number++;
      const marker = ordered ? `${number}. ` : "- ";
      const body = inside(item).trim().replace(/\n{3,}/g, "\n\n");
      return marker + body.replace(/\n/g, `\n${" ".repeat(marker.length)}`);
    });
  return `\n\n${items.join("\n")}\n\n`;
}

function render(node: DomNode): string {
  if (node.nodeType === TEXT) return escaped((node.textContent ?? "").replace(/\s+/g, " "));
  // Comments are never shown, so they don't count as the page's text.
  if (node.nodeType !== ELEMENT) return "";
  const tag = (node.tagName ?? "").toLowerCase();
  if (NEVER.has(tag)) return "";
  const heading = /^h([1-6])$/.exec(tag)?.[1];
  if (heading !== undefined) {
    const text = inside(node).trim();
    return text === "" ? "" : `\n\n${"#".repeat(Number(heading))} ${text.replace(/\s*\n\s*/g, " ")}\n\n`;
  }
  if (BLOCK.has(tag)) return `\n\n${inside(node)}\n\n`;
  switch (tag) {
    case "br":
      return "\n";
    case "hr":
      return "\n\n---\n\n";
    case "ul":
    case "ol":
      return list(node, tag === "ol");
    case "li":
      return `\n- ${inside(node).trim()}\n`;
    case "blockquote": {
      const text = inside(node).trim().replace(/\n{3,}/g, "\n\n");
      return text === "" ? "" : `\n\n${text.replace(/^/gm, "> ")}\n\n`;
    }
    case "pre": {
      const text = (node.textContent ?? "").replace(/\n$/, "");
      const fence = fenceFor(text, 3);
      const code = [...node.childNodes].find((child) => child.tagName?.toLowerCase() === "code");
      const language = /language-([\w+-]+)/.exec(code?.getAttribute?.("class") ?? "")?.[1] ?? "";
      return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
    }
    case "code": {
      const text = (node.textContent ?? "").replace(/\s+/g, " ");
      if (text.trim() === "") return "";
      const fence = fenceFor(text, 1);
      const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
      return `${fence}${pad}${text}${pad}${fence}`;
    }
    case "strong":
    case "b":
    case "em":
    case "i": {
      const text = inside(node);
      const mark = tag === "strong" || tag === "b" ? "**" : "_";
      return text.trim() === "" ? text : `${mark}${text.trim()}${mark}`;
    }
    case "a": {
      const text = inside(node).trim().replace(/\s*\n\s*/g, " ");
      const href = node.getAttribute?.("href");
      if (text === "" || !href) return text;
      return `[${text}](${href.replace(/[()\s]/g, encodeURIComponent)})`;
    }
    case "table":
      return `\n\n${[...node.childNodes].map(render).join("").trim()}\n\n`;
    case "thead":
    case "tbody":
    case "tfoot":
      return [...node.childNodes].filter((child) => child.nodeType === ELEMENT).map(render).join("");
    case "tr":
      return `${[...node.childNodes].map((cell) => render(cell).trim()).filter(Boolean).join(" | ")}\n`;
    default:
      return inside(node);
  }
}

export function markdownOf(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  return render(document.body as unknown as DomNode)
    .replace(/[ \t]*\n[ \t]*(?=\n)/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
