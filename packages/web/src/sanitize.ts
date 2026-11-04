/** Web text is hostile. These clean it and look for signs of an attack; none of them make it safe. */

// Control characters, zero-width and bidi marks, and the invisible "tag" characters used to smuggle text.
const INVISIBLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁯﻿\u{e0000}-\u{e007f}]/gu;

export const clean = (text: string): string => text.replace(INVISIBLE, "");

// Commands. A reader's answer holding one of these is withheld.
const COMMANDS_TO_AI = [
  /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:instructions?|prompts?|rules|guidelines)\b/i,
  /\b(?:new|updated|real|actual|important)\s+(?:system\s+)?instructions?\s*:/i,
  /\byou\s+(?:are\s+now|must\s+now|should\s+now)\b/i,
  /\b(?:do\s+not|don't|never)\s+(?:tell|inform|mention\s+(?:this\s+)?to)\s+the\s+user\b/i,
  /<\|?(?:im_start|im_end|system|endoftext)\|?>/i,
  /^\s*(?:system|assistant)\s*:/im,
];
// Wording that an honest page about AI can use too, so it only earns a warning.
const AIMED_AT_AI = [/\bsystem\s+prompt\b/i, /\b(?:AI|LLM)\s+(?:agents?|assistants?|models?)\s*[:,]?\s+(?:must|should|please|shall)\b/i];

export const givesCommands = (text: string): boolean => COMMANDS_TO_AI.some((pattern) => pattern.test(text));
export const looksLikeInstructions = (text: string): boolean => givesCommands(text) || AIMED_AT_AI.some((pattern) => pattern.test(text));

const URLS = /https?:\/\/[^\s<>"'`)\]]+/gi;
const withoutEndPunctuation = (url: string) => url.replace(/[.,;:!?]+$/, "");

export const urlsIn = (text: string): string[] => [...text.matchAll(URLS)].map((match) => withoutEndPunctuation(match[0]));

function readable(url: string): string {
  let text = url;
  try {
    text = decodeURIComponent(url);
  } catch {
    /* Not valid encoding, so it's read as it is. */
  }
  return text.replace(/[_+\-/.=&?#]+/g, " ");
}

const MAX_LINK = 500;

/** A link is attacker-written text that reaches the agent, so it can't be long or read as a command. */
export const linkIsClean = (url: string): boolean => url.length <= MAX_LINK && !givesCommands(readable(url));

/** A reader talked into writing a link could hand the agent a way to send data out, so it can only repeat whole links from the page. */
export function dropInventedLinks(answer: string, source: string): string {
  const known = new Set(urlsIn(source));
  return answer.replace(URLS, (raw) => {
    const url = withoutEndPunctuation(raw);
    return known.has(url) && linkIsClean(url) ? raw : `[link removed]${raw.slice(url.length)}`;
  });
}
