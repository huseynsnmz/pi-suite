// The little of MCP that Claude Code needs to see pi's tools: the Agent SDK hands this object a
// transport and passes JSON-RPC through it. The MCP SDK would bring a web server and more to do this.
import type { Tool } from "@earendil-works/pi-ai";

export interface ToolResult {
	content: unknown[];
	isError?: boolean;
}

interface Transport {
	onmessage?: (message: JsonRpc) => void;
	start(): Promise<void>;
	send(message: unknown): Promise<void>;
	close(): Promise<void>;
}

interface JsonRpc {
	id?: string | number;
	method?: string;
	params?: { protocolVersion?: string; _meta?: Record<string, unknown> };
}

const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

export class ToolServer {
	readonly #tools: unknown[];
	readonly #call: (toolUseId: string | undefined) => Promise<ToolResult>;
	#transport: Transport | undefined;

	constructor(name: string, tools: readonly Tool[], call: (toolUseId: string | undefined) => Promise<ToolResult>) {
		this.name = name;
		this.#call = call;
		this.#tools = tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: { type: "object", ...(JSON.parse(JSON.stringify(tool.parameters ?? {})) as object) },
		}));
	}

	readonly name: string;

	async connect(transport: Transport): Promise<void> {
		this.#transport = transport;
		transport.onmessage = (message) => void this.#handle(message);
		await transport.start();
	}

	async close(): Promise<void> {
		await this.#transport?.close();
	}

	async #handle(message: JsonRpc): Promise<void> {
		// A notification has no id and wants no answer.
		if (message.id === undefined) return;
		const answer = await this.#answer(message);
		await this.#transport?.send({ jsonrpc: "2.0", id: message.id, ...answer }).catch(() => undefined);
	}

	async #answer(message: JsonRpc): Promise<{ result: unknown } | { error: { code: number; message: string } }> {
		switch (message.method) {
			case "initialize":
				return { result: { protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: this.name, version: "1.0.0" } } };
			case "ping":
				return { result: {} };
			case "tools/list":
				return { result: { tools: this.#tools } };
			case "tools/call":
				try {
					return { result: await this.#call(message.params?._meta?.["claudecode/toolUseId"] as string | undefined) };
				} catch (error) {
					return { error: { code: INTERNAL_ERROR, message: (error as Error).message } };
				}
			default:
				return { error: { code: METHOD_NOT_FOUND, message: `Unknown method ${message.method}` } };
		}
	}
}
