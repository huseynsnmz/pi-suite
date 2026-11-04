// The model asks, the user answers. An answer is only information: tool permissions stay as they are.
import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { ASK_TOOL, displayCommand } from "./modes.ts";

const TYPES = ["text", "yes_no", "select", "multi_select"] as const;
type QuestionType = (typeof TYPES)[number];
const MAX_QUESTIONS = 6;
const MAX_OPTIONS = 10;
const MAX_OPTION_CHARS = 200;
const MAX_QUESTION_CHARS = 500;
const CALL_LINE_CHARS = 120;
export const OWN_ANSWER = "Type my own answer";

export interface Question {
  question: string;
  type: string;
  options?: string[];
}

interface Clean {
  question: string;
  type: QuestionType;
  options: string[];
}

export type Dialogs = Pick<ExtensionUIContext, "select" | "input" | "custom">;

/** Dialogs draw this text, so it can't drive the terminal or fake another row. */
function oneLine(text: string): string {
  return displayCommand(text.replace(/\s+/g, " ").trim());
}

function cleanOption(option: string): string {
  return oneLine(option).slice(0, MAX_OPTION_CHARS);
}

/**
 * The model writes the rest of the dialog, so this part says who is asking. Without it, a question
 * could pass for Pi's permission prompts or plan approval.
 */
function titleOf(question: string, index: number, total: number): string {
  return `Agent question${total === 1 ? "" : ` ${index + 1}/${total}`}: ${question}`;
}

const SENT_TO_MODEL = "(your answer goes to the model)";

/** A bad call tells the model what to fix, before the user sees any of it. */
export function checkedQuestions(questions: readonly Question[]): Clean[] {
  if (questions.length === 0) throw new Error("Ask at least one question.");
  if (questions.length > MAX_QUESTIONS) throw new Error(`Ask at most ${MAX_QUESTIONS} questions at a time.`);
  return questions.map(({ question, type, options }) => {
    const text = oneLine(question);
    if (text === "") throw new Error("A question needs text.");
    if (text.length > MAX_QUESTION_CHARS) throw new Error(`Keep a question under ${MAX_QUESTION_CHARS} characters.`);
    if (!(TYPES as readonly string[]).includes(type)) throw new Error(`Unknown question type "${type}". Use ${TYPES.join(", ")}.`);
    const kind = type as QuestionType;
    if (kind === "text" || kind === "yes_no") {
      if (options !== undefined) throw new Error(`A ${kind} question takes no options.`);
      return { question: text, type: kind, options: kind === "yes_no" ? ["Yes", "No"] : [] };
    }
    const clean = (options ?? []).map(cleanOption);
    if (clean.length < 2 || clean.length > MAX_OPTIONS) throw new Error(`A ${kind} question needs 2 to ${MAX_OPTIONS} options.`);
    if (clean.includes("") || new Set(clean).size < clean.length) throw new Error("Options must be different and not empty.");
    if (clean.includes(OWN_ANSWER)) throw new Error(`"${OWN_ANSWER}" is added for you. Leave it out.`);
    return { question: text, type: kind, options: clean };
  });
}

/** Space picks, Enter answers. Undefined means Esc, or the run was stopped. */
export function pickSeveral(
  ui: Dialogs,
  title: string,
  options: readonly string[],
  signal?: AbortSignal,
  already: readonly string[] = [],
): Promise<string[] | undefined> {
  return ui.custom<string[] | undefined>((tui, theme, _keys, done) => {
    const picked = new Set(already.map((option) => options.indexOf(option)).filter((index) => index >= 0));
    let row = 0;
    const stop = () => done(undefined);
    signal?.addEventListener("abort", stop, { once: true });
    const finish = (value: string[] | undefined) => {
      signal?.removeEventListener("abort", stop);
      done(value);
    };
    return {
      invalidate() {},
      handleInput(data: string) {
        if (matchesKey(data, "up")) row = (row + options.length - 1) % options.length;
        else if (matchesKey(data, "down")) row = (row + 1) % options.length;
        else if (matchesKey(data, "space")) {
          if (!picked.delete(row)) picked.add(row);
        } else if (matchesKey(data, "enter")) return finish(options.filter((_option, index) => picked.has(index)));
        else if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) return finish(undefined);
        tui.requestRender();
      },
      render(width: number) {
        const rule = theme.fg("accent", "─".repeat(width));
        // Wrapped, not cut: the model receives the whole option, so the user has to see all of it.
        const rows = options.flatMap((option, index) => {
          const box = picked.has(index) ? "[x]" : "[ ]";
          const lead = ` ${index === row ? "→" : " "} ${box} `;
          return wrapTextWithAnsi(option, Math.max(1, width - lead.length)).map((part, at) => {
            const line = truncateToWidth(`${at === 0 ? lead : " ".repeat(lead.length)}${part}`, width);
            return index === row ? theme.fg("accent", line) : line;
          });
        });
        const hint = theme.fg("dim", " ↑↓ navigate  space pick  enter answer  escape cancel");
        const heading = wrapTextWithAnsi(theme.bold(title), Math.max(1, width - 2)).map((line) => ` ${line}`);
        return [rule, "", ...heading, "", ...rows, "", truncateToWidth(hint, width), "", rule];
      },
    };
  });
}

async function ownAnswer(ui: Dialogs, title: string, signal?: AbortSignal): Promise<string | undefined> {
  const typed = await ui.input(`${title} ${SENT_TO_MODEL}`, "", { signal });
  return typed?.trim() || undefined;
}

/** Undefined means the user closed it. Leaving their own answer empty goes back to the options. */
async function answerOf(ui: Dialogs, question: Clean, title: string, drawsDialogs: boolean, signal?: AbortSignal): Promise<string | undefined> {
  if (question.type === "text") {
    const typed = await ui.input(`${title} ${SENT_TO_MODEL}`, "", { signal });
    return typed === undefined ? undefined : typed.trim() || "(left empty)";
  }
  // Only the terminal can draw the list of boxes, and other clients answer it as if the user had closed it.
  if (question.type === "multi_select" && !drawsDialogs) {
    const typed = await ui.input(`${title} Pick from: ${question.options.join(" | ")} ${SENT_TO_MODEL}`, "", { signal });
    return typed === undefined ? undefined : typed.trim() || "(none picked)";
  }
  const options = [...question.options, OWN_ANSWER];
  let already: string[] = [];
  for (;;) {
    if (signal?.aborted) return undefined;
    if (question.type === "multi_select") {
      const picked = await pickSeveral(ui, title, options, signal, already);
      if (picked === undefined) return undefined;
      already = picked;
      const named = picked.filter((option) => option !== OWN_ANSWER);
      if (named.length === picked.length) return named.length === 0 ? "(none picked)" : JSON.stringify(named);
      const typed = await ownAnswer(ui, title, signal);
      if (typed !== undefined) return JSON.stringify([...named, typed]);
    } else {
      const picked = await ui.select(title, options, { signal });
      if (picked === undefined) return undefined;
      if (picked !== OWN_ANSWER) return picked;
      const typed = await ownAnswer(ui, title, signal);
      if (typed !== undefined) return typed;
    }
  }
}

export async function interview(ui: Dialogs, questions: readonly Clean[], signal?: AbortSignal, drawsDialogs = true): Promise<string> {
  const lines: string[] = [];
  for (const [index, question] of questions.entries()) {
    const title = titleOf(question.question, index, questions.length);
    const answer = await answerOf(ui, question, title, drawsDialogs, signal);
    if (answer === undefined) {
      const left = lines.length === 0 ? "" : `\nAnswered before that:\n${lines.join("\n")}`;
      const who = signal?.aborted ? "The run was stopped" : "The user closed the questions";
      return `${who} at: ${question.question}\nDon't guess the rest. Go on only with what they already told you, or ask what they want.${left}`;
    }
    lines.push(`Q: ${question.question}\nA: ${answer}`);
  }
  return lines.join("\n");
}

/** The questions, not their JSON. The arguments arrive a piece at a time, so any of it can be missing. */
export function askedLine(args: { questions?: readonly Partial<Question>[] }): string {
  const questions = Array.isArray(args.questions) ? args.questions : [];
  const first = typeof questions[0]?.question === "string" ? oneLine(questions[0].question).slice(0, CALL_LINE_CHARS) : "";
  return questions.length > 1 ? `${first} (+${questions.length - 1} more)` : first;
}

export function registerInterview(pi: ExtensionAPI): void {
  pi.registerTool({
    name: ASK_TOOL,
    label: "Ask",
    description: "Ask the user questions, one dialog at a time, and get their answers. The user can always type their own answer instead of the options.",
    promptSnippet: "Ask the user questions when a decision is theirs",
    promptGuidelines: [
      `Use ${ASK_TOOL} when a decision is the user's to make and the work depends on it, or to interview them about what they want. Don't ask what you can find out by reading, and don't use it for permission to run a tool.`,
    ],
    executionMode: "sequential",
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          question: Type.String(),
          type: Type.String({ enum: [...TYPES], description: "text: free answer. yes_no. select: one option. multi_select: any number." }),
          options: Type.Optional(Type.Array(Type.String(), { description: "For select and multi_select" })),
        }),
      ),
    }),
    renderCall: (args, theme) => new Text(theme.fg("muted", askedLine(args)), 0, 0),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const questions = checkedQuestions(params.questions);
      const text = ctx.hasUI
        ? await interview(ctx.ui, questions, signal, ctx.mode === "tui")
        : "Nobody can answer here. Decide for yourself, and say what you assumed.";
      return { content: [{ type: "text", text }], details: {} };
    },
  });
}
