// A fake OpenAI-compatible model. The prompt's text scripts its tool calls.
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const [port, requests] = process.argv.slice(2);

function chunk(res, delta, finish = null) {
	const body = { id: "x", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] };
	res.write(`data: ${JSON.stringify(body)}\n\n`);
}

function reply(res, content, call) {
	res.writeHead(200, { "content-type": "text/event-stream" });
	if (content) chunk(res, { role: "assistant", content });
	if (call) {
		chunk(res, { role: "assistant", tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] });
		chunk(res, {}, "tool_calls");
	} else {
		chunk(res, {}, "stop");
	}
	res.write("data: [DONE]\n\n");
	res.end();
}

const SCRIPT = {
	PRINT: { name: "bash", args: { command: "printf '\\033]0;EVILTITLE\\007\\033]52;c;RVZJTA==\\007printed\\n'" } },
	ARG: { name: "bash", args: { command: "echo arg\u001b]0;ARGTITLE\u0007\u001b]52;c;RVZJTA==\u0007" } },
	CUSTOM: { name: "no_such_tool", args: { note: "x\u001b]0;CUSTOMTITLE\u0007\u001b[2Jy" } },
	TOUCH: { name: "bash", args: { command: "true" } },
	SLEEP: { name: "bash", args: { command: "sleep 20" } },
	CATENV: { name: "bash", args: { command: "cat .env" } },
	READENV: { name: "read", args: { path: ".env" } },
	TODOPLAN: { name: "todo", args: { plan: ["Read the code", "Write the tests", "Ship it"], start: 1 } },
	TODONEXT: { name: "todo", args: { done: [1], start: 2 } },
	TODOBAD: { name: "todo", args: { done: [99] } },
	TODOEVIL: { name: "todo", args: { add: ["evil\u001b]0;TODOTITLE\u0007text"] } },
	TODOFINISH: { name: "todo", args: { done: [1, 2, 3] } },
};

createServer((req, res) => {
	let raw = "";
	req.on("data", (data) => (raw += data));
	req.on("end", () => {
		if (requests) appendFileSync(requests, `${raw}\n`);
		const body = JSON.parse(raw || "{}");
		const last = body.messages?.at(-1);
		if (last?.role === "tool") return reply(res, "FINISHED");
		const text = typeof last?.content === "string" ? last.content : (last?.content ?? []).map((part) => part.text ?? "").join("");
		if (text === "SLOW") {
			res.writeHead(200, { "content-type": "text/event-stream" });
			chunk(res, { role: "assistant", content: "slowfirst " });
			return setTimeout(() => {
				chunk(res, { role: "assistant", content: "slowlast OK" });
				chunk(res, {}, "stop");
				res.write("data: [DONE]\n\n");
				res.end();
			}, 3_000);
		}
		if (text === "THINK") {
			res.writeHead(200, { "content-type": "text/event-stream" });
			chunk(res, { role: "assistant", reasoning_content: "SECRETREASON" });
			return setTimeout(() => {
				chunk(res, { role: "assistant", content: "thinkdone OK" });
				chunk(res, {}, "stop");
				res.write("data: [DONE]\n\n");
				res.end();
			}, 2_000);
		}
		return reply(res, SCRIPT[text] ? "" : "OK", SCRIPT[text]);
	});
}).listen(Number(port), "127.0.0.1");
