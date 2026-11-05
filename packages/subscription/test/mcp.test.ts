import assert from "node:assert/strict";
import { test } from "node:test";
import { Type } from "typebox";

import { ToolServer, type ToolResult } from "../src/mcp.ts";

const tools = [{ name: "read", description: "Read", parameters: Type.Object({ path: Type.String() }) }];

/** Answers each message and gives what came back, as the Agent SDK's transport would. */
async function connected(call: (id: string | undefined) => Promise<ToolResult>) {
	const sent: any[] = [];
	const transport: any = { start: async () => {}, close: async () => {}, send: async (message: unknown) => void sent.push(message) };
	await new ToolServer("pi", tools, call).connect(transport);
	return async (message: object) => {
		const before = sent.length;
		transport.onmessage(message);
		await new Promise((resolve) => setTimeout(resolve, 5));
		return sent.slice(before);
	};
}

test("answers what Claude Code asks when it connects", async () => {
	const ask = await connected(async () => ({ content: [] }));
	const [init] = await ask({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
	assert.equal(init.id, 1);
	assert.equal(init.result.protocolVersion, "2025-06-18");
	assert.deepEqual(init.result.capabilities, { tools: {} });
	assert.deepEqual(await ask({ jsonrpc: "2.0", method: "notifications/initialized" }), []);
	const [list] = await ask({ jsonrpc: "2.0", id: 2, method: "tools/list" });
	assert.equal(list.result.tools[0].name, "read");
	assert.equal(list.result.tools[0].inputSchema.type, "object");
	assert.ok(list.result.tools[0].inputSchema.properties.path);
	assert.deepEqual((await ask({ jsonrpc: "2.0", id: 3, method: "ping" }))[0].result, {});
});

test("a tool call waits for pi's result, matched by the tool_use id", async () => {
	const ids: unknown[] = [];
	const ask = await connected(async (id) => (ids.push(id), { content: [{ type: "text", text: "hello" }] }));
	const [answer] = await ask({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "read", _meta: { "claudecode/toolUseId": "toolu_1" } } });
	assert.deepEqual(ids, ["toolu_1"]);
	assert.deepEqual(answer.result.content, [{ type: "text", text: "hello" }]);
});

test("a session that ends, or a method it doesn't know, gets an error rather than silence", async () => {
	const ask = await connected(async () => {
		throw new Error("Claude Code session ended");
	});
	const [failed] = await ask({ jsonrpc: "2.0", id: 5, method: "tools/call", params: {} });
	assert.match(failed.error.message, /session ended/);
	const [unknown] = await ask({ jsonrpc: "2.0", id: 6, method: "resources/list" });
	assert.equal(unknown.error.code, -32601);
});
