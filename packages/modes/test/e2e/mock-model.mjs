// A fake OpenAI-compatible model. The prompt text scripts its tool calls, and
// judge requests are counted so tests can see exactly when the judge ran.
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const [port, logPath] = process.argv.slice(2);

function chunk(res, delta, finish = null) {
  const body = { id: "x", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] };
  res.write(`data: ${JSON.stringify(body)}\n\n`);
}

function reply(res, content, call) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  if (content) chunk(res, { role: "assistant", content });
  if (call) {
    chunk(res, { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] });
    chunk(res, {}, "tool_calls");
  } else {
    chunk(res, {}, "stop");
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

function scriptedCall(text, tools) {
  const [verb, ...rest] = text.split(":");
  const arg = rest.join(":");
  const off = tools.includes("yolo_bash");
  if (verb === "RUN") return { name: off ? "yolo_bash" : "bash", args: { command: arg } };
  if (verb === "WRITE") return off ? { name: "yolo_write", args: { file: arg, content: "x" } } : { name: "write", args: { path: arg, content: "x" } };
  if (verb === "READ") return { name: "read", args: { path: arg } };
  if (verb === "SUBAGENT") return { name: "subagent", args: { agent: "scout", task: "x" } };
  if (verb === "APPLY") return { name: "permissions_apply", args: { bash: [arg] } };
  if (verb === "PLAN") return { name: "submit_plan", args: { plan: "PLANBODY step one" } };
  if (verb === "ASK") return { name: "ask_questions", args: { questions: [
    { question: "Which database?\u001b]0;ASKTITLE\u0007", type: "select", options: ["Postgres", "SQLite"] },
    { question: "Add tests?", type: "yes_no" },
    { question: "Which targets?", type: "multi_select", options: ["web", "ios", "android"] },
    { question: "Anything else?", type: "text" },
  ] } };
  if (verb === "ASKBAD") return { name: "ask_questions", args: { questions: [{ question: "Pick", type: "select", options: ["one"] }] } };
  return undefined;
}

createServer((req, res) => {
  let raw = "";
  req.on("data", (data) => (raw += data));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    const tools = (body.tools ?? []).map((tool) => tool.function?.name);
    if (tools.includes("report_verdict")) {
      appendFileSync(logPath, "judge\n");
      return reply(res, "", { name: "report_verdict", args: { verdict: "allow" } });
    }
    const last = body.messages?.at(-1);
    if (last?.role === "tool") return reply(res, `FINISHED ${String(last.content).slice(0, 500)}`);
    const text = typeof last?.content === "string" ? last.content : (last?.content ?? []).map((part) => part.text ?? "").join("");
    const system = JSON.stringify(body.messages?.[0] ?? "");
    appendFileSync(logPath, `chat plan=${system.includes("Plan mode is on")} readonly=${system.includes("Read-only mode is on")} submit=${tools.includes("submit_plan")} bash=${tools.includes("bash")} alias=${tools.includes("yolo_bash")}\n`);
    return reply(res, scriptedCall(text, tools) ? "" : "OK", scriptedCall(text, tools));
  });
}).listen(Number(port), "127.0.0.1");
