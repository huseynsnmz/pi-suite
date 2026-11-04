// A fake model server. It logs which model each request names, and the prompt's text scripts tool calls.
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const [port, log] = process.argv.slice(2);

function chunk(res, delta, finish = null) {
  res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
}

function reply(res, content, call) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  if (content) chunk(res, { role: "assistant", content });
  if (call) {
    chunk(res, { role: "assistant", tool_calls: [{ index: 0, id: `c${Date.now()}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] });
    chunk(res, {}, "tool_calls");
  } else chunk(res, {}, "stop");
  res.write("data: [DONE]\n\n");
  res.end();
}

const SCRIPT = {
  WRITE: { name: "write", args: { path: "made.txt", content: "x" } },
  READ: { name: "read", args: { path: "AGENTS.md" } },
  PLAN: { name: "submit_plan", args: { plan: "PLANBODY step one" } },
  RUN: { name: "bash", args: { command: "touch judged.txt" } },
};

createServer((req, res) => {
  let raw = "";
  req.on("data", (data) => (raw += data));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    const tools = (body.tools ?? []).map((tool) => tool.function?.name);
    const last = body.messages?.at(-1);
    const text = typeof last?.content === "string" ? last.content : (last?.content ?? []).map((part) => part.text ?? "").join("");
    const judge = tools.includes("report_verdict");
    appendFileSync(log, `${JSON.stringify({ model: body.model, role: last?.role, text: text.slice(0, 60), tail: text.slice(-200), judge, tools: tools.length, toolNames: tools })}\n`);
    if (judge) return reply(res, "", { name: "report_verdict", args: { verdict: "allow" } });
    if (last?.role === "tool") return reply(res, "FINISHED");
    if (text === "OVERLOAD" && body.model !== "back") {
      res.writeHead(529, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "overloaded" } }));
    }
    return reply(res, SCRIPT[text] ? "" : "OK", SCRIPT[text]);
  });
}).listen(Number(port), "127.0.0.1");
