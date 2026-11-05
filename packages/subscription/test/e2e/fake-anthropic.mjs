// A fake Anthropic API for the real Claude Code binary. The prompt's text scripts what it answers.
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const [port, log] = process.argv.slice(2);
// What a plan over its limit with extra usage on looks like: refused by the plan, served from credits.
const BILLED = {
  "anthropic-ratelimit-unified-status": "rejected",
  "anthropic-ratelimit-unified-overage-status": "allowed",
  "anthropic-ratelimit-unified-representative-claim": "five_hour",
};

async function stream(res, model, blocks, stop, headers = {}, pause = 0) {
  res.writeHead(200, { "content-type": "text/event-stream", ...headers });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("message_start", { message: { id: `msg_${Date.now()}`, type: "message", role: "assistant", model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
  // A model that takes its time, to see when in a reply the report arrives.
  if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
  blocks.forEach((block, index) => {
    if (block.text !== undefined) {
      send("content_block_start", { index, content_block: { type: "text", text: "" } });
      send("content_block_delta", { index, delta: { type: "text_delta", text: block.text } });
    } else {
      send("content_block_start", { index, content_block: { type: "tool_use", id: `toolu_${Date.now()}`, name: block.name, input: {} } });
      send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    }
    send("content_block_stop", { index });
  });
  send("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } });
  send("message_stop", {});
  res.end();
}

createServer((req, res) => {
  let raw = "";
  req.on("data", (data) => (raw += data));
  req.on("end", () => {
    if (!req.url.includes("/v1/messages")) {
      res.writeHead(404);
      return res.end();
    }
    if (req.url.includes("count_tokens")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end('{"input_tokens":1}');
    }
    const body = JSON.parse(raw || "{}");
    const names = (body.tools ?? []).map((tool) => tool.name);
    // Everything since the model last spoke. Claude Code can put a tool's result in its own message.
    const messages = body.messages ?? [];
    let first = messages.length;
    while (first > 0 && messages[first - 1].role !== "assistant") first -= 1;
    const parts = messages.slice(first).flatMap((message) => (Array.isArray(message.content) ? message.content : [{ type: "text", text: String(message.content ?? "") }]));
    const answered = parts.find((part) => part.type === "tool_result");
    const words = parts.filter((part) => part.type === "text").map((part) => part.text).join(" ");
    const system = JSON.stringify(body.system ?? "");
    appendFileSync(log, `${JSON.stringify({ names, words, result: answered ? JSON.stringify(answered.content).slice(0, 300) : undefined, isError: answered?.is_error, promptSaysPi: system.includes("in pi, a terminal coding harness") })}\n`);
    if (answered) return stream(res, body.model, [{ text: "FINISHED" }], "end_turn");
    if (words.includes("WRITEIT")) return stream(res, body.model, [{ name: "mcp__pi__write", input: { path: "via-claude.txt", content: "x" } }], "tool_use");
    if (words.includes("NATIVE")) return stream(res, body.model, [{ name: "Write", input: { file_path: "native.txt", content: "x" } }], "tool_use");
    if (words.includes("BILLSLOW")) return stream(res, body.model, [{ text: "SLOWANSWER" }], "end_turn", BILLED, 4000);
    if (words.includes("BILLME")) return stream(res, body.model, [{ text: "BILLEDANSWER" }], "end_turn", BILLED);
    return stream(res, body.model, [{ text: "OK" }], "end_turn");
  });
}).listen(Number(port), "127.0.0.1");
