/** One tool, `agent`: hands a task to a fresh copy of Pi, and gives back its final answer as text. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];
const ANSWER_CHARS = 30_000;
const ERROR_CHARS = 500;

export interface ChildOptions {
  type: "explore" | "general";
  model?: string;
  thinking?: string;
}

/** The prompt goes in on stdin, so it can't be taken for a flag and doesn't show in the process list. */
export function childArgs({ type, model, thinking }: ChildOptions): string[] {
  return ["-p", "--no-session", ...(model === undefined ? [] : ["--model", model]), ...(thinking === undefined ? [] : ["--thinking", thinking]), ...(type === "explore" ? ["--tools", READ_ONLY_TOOLS.join(",")] : [])];
}

/** The mode a child runs in. Plan's only way out is a person, so its explore agents just read, and yolo has to be asked for. */
function childMode(mode: string): string {
  if (mode === "plan") return "read-only";
  return mode === "yolo" ? "normal" : mode;
}

/** How the permission system and pi-router know this is a child, and pi-modes knows its mode. */
export function childEnv(base: NodeJS.ProcessEnv, parentSession: string, mode: string | undefined): NodeJS.ProcessEnv {
  return { ...base, PI_SUBAGENT_CHILD: "1", PI_SUBAGENT_PARENT_SESSION: parentSession, ...(mode === undefined ? {} : { PI_MODES_START: childMode(mode) }) };
}

export function trimAnswer(answer: string): string {
  const text = answer.trim();
  return text.length > ANSWER_CHARS ? `${text.slice(0, ANSWER_CHARS)}\n[The answer was cut at ${ANSWER_CHARS} characters.]` : text;
}

export function runChild(cwd: string, command: string[], env: NodeJS.ProcessEnv, prompt: string, signal: AbortSignal | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, command, { cwd, env, stdio: ["pipe", "pipe", "pipe"], signal });
    let out = "";
    let err = "";
    // A character can be split across two chunks.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data) => (out += data));
    child.stderr.on("data", (data) => (err = (err + data).slice(-ERROR_CHARS)));
    child.stdin.on("error", () => {}); // It can exit before reading. Its exit code says why.
    child.on("error", (error) => reject(signal?.aborted ? new Error("The agent was stopped.") : error));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`The agent failed: ${err.trim() || `exit code ${code}`}`));
      if (out.trim() === "") return reject(new Error("The agent gave no answer."));
      resolve(trimAnswer(out));
    });
    child.stdin.end(prompt);
  });
}

export default function piSubagent(pi: ExtensionAPI): void {
  // A child's job is its own task. Agents starting agents is how a small task gets a big bill.
  if (process.env.PI_SUBAGENT_CHILD === "1") return;

  pi.registerTool({
    name: "agent",
    label: "Agent",
    description:
      "Hand a task to a fresh agent, and get back its final answer as text. It starts with none of this conversation, so the prompt must say everything it needs, and what to report. Use it for wide searches, for reading a lot, and for an independent review, so all that doesn't fill this context. Several calls in one message run at once. Don't use it for what a direct tool call or two can answer.",
    parameters: Type.Object({
      description: Type.String({ description: "What it's doing, in 3 to 5 words" }),
      prompt: Type.String({ description: "The whole task, standing on its own" }),
      type: Type.Optional(Type.Union([Type.Literal("explore"), Type.Literal("general")], { description: "explore (the default) can only read. general can also edit and run commands, under the same permission rules" })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const probe: { mode?: string } = {};
      pi.events.emit("pi-modes:mode", probe);
      const model = ctx.model === undefined ? undefined : `${ctx.model.provider}/${ctx.model.id}`;
      const args = childArgs({ type: params.type ?? "explore", model, thinking: pi.getThinkingLevel() });
      // Pi may run from a compiled binary, with no script to name.
      const script = process.argv[1];
      const command = script !== undefined && existsSync(script) ? [script, ...args] : args;
      const answer = await runChild(ctx.cwd, command, childEnv(process.env, ctx.sessionManager.getSessionId(), probe.mode), params.prompt, signal);
      return { content: [{ type: "text" as const, text: answer }], details: {} };
    },
  });
}
