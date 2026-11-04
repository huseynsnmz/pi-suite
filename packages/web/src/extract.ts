/** Turns a response into plain Markdown, leaving out what a person wouldn't see: that's where attacks on a reader hide. */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { markdownOf } from "./markdown.ts";
import { clean } from "./sanitize.ts";

const NEVER_SHOWN = "script,style,noscript,template,iframe,object,embed,svg,canvas,form,input,textarea,select,button,img,picture,video,audio,meta,link,head";
const HIDDEN = [
  "[hidden]", "[aria-hidden='true']",
  "[style*='display:none' i]", "[style*='display: none' i]",
  "[style*='visibility:hidden' i]", "[style*='visibility: hidden' i]",
  "[style*='opacity:0' i]", "[style*='opacity: 0' i]",
  "[style*='font-size:0' i]", "[style*='font-size: 0' i]",
  "[style*='left:-' i]", "[style*='left: -' i]", "[style*='text-indent:-' i]", "[style*='text-indent: -' i]",
].join(",");

// Rules inside @media and the like only apply sometimes, so they don't say that an element is hidden.
const AT_BLOCK = /@[^{};]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g;
const HIDING_RULE = /([^{}]+)\{[^{}]*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])|font-size\s*:\s*0(?![.\d]))[^{}]*\}/gi;

/** Hiding text through a class is the same attack as through a style attribute. Stylesheets from other files can't be seen here. */
function removeHiddenByStylesheet(document: ReturnType<typeof parseHTML>["document"]): void {
  for (const style of document.querySelectorAll("style")) {
    for (const rule of (style.textContent ?? "").replace(AT_BLOCK, "").matchAll(HIDING_RULE)) {
      try {
        for (const node of document.querySelectorAll(rule[1].trim())) {
          // Pages hide the body while they load, and that says nothing about what's in it.
          if (node.tagName !== "BODY" && node.tagName !== "HTML") node.remove();
        }
      } catch {
        /* A selector this parser can't handle. */
      }
    }
  }
}

function htmlToMarkdown(html: string, base: string): string {
  const { document } = parseHTML(html);
  removeHiddenByStylesheet(document);
  // The reader can only pass on whole links, so relative ones are made whole.
  for (const link of document.querySelectorAll("a[href]")) {
    try {
      link.setAttribute("href", new URL(link.getAttribute("href") ?? "", base).href);
    } catch {
      link.removeAttribute("href");
    }
  }
  const title = document.querySelector("title")?.textContent?.trim() ?? "";
  for (const node of document.querySelectorAll(`body ${NEVER_SHOWN.split(",").join(",body ")},${HIDDEN}`)) node.remove();
  const article = new Readability(document as unknown as Document).parse();
  const content = article?.content ?? document.querySelector("body")?.innerHTML ?? "";
  const markdown = markdownOf(content);
  return title ? `# ${title}\n\n${markdown}` : markdown;
}

const TEXT_TYPE = /^(?:text\/|application\/(?:json|xml|[a-z.+-]+\+(?:json|xml))|$)/i;

export function toText(body: Buffer, contentType: string, base = "https://invalid.invalid/"): string {
  const type = contentType.split(";")[0].trim();
  // Not the type's name: it's written by the server, and errors reach the agent without passing the reader.
  if (!TEXT_TYPE.test(type)) throw new Error("This kind of page can't be read, only text and web pages");
  const text = body.toString("utf8");
  const isHtml = /html/i.test(type) || (type === "" && /^\s*<(?:!doctype|html)/i.test(text));
  return clean(isHtml ? htmlToMarkdown(text, base) : text);
}
