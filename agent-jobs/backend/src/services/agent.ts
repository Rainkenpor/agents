/**
 * internal.service.ts — Agente interno con fetch nativo
 *
 * Implementa un agente autónomo con bucle de herramientas usando fetch directo
 * contra la API de GitHub Copilot / OpenAI (SSE streaming). Sin dependencia del
 * OpenAI SDK para la ejecución; sólo se usan tipos locales.
 *
 * AGENT_MODEL formats:
 *   copilot/gpt-4o            → GitHub Copilot API (token OAuth directo)
 *   github-copilot/gpt-4o    → GitHub Copilot API (token OAuth directo)
 *   openai/gpt-4o             → OpenAI con token guardado
 *   gpt-4o                    → OpenAI/compatible con variables CHAT_*
 *
 * Lee configuración de agente desde:
 *   1. {dirPath}/.opencode/agent/{agentType}.md
 *   2. {cwd}/agent/{agentType}.md  (fallback servidor)
 *   3. {cwd}/agent/subagents/{agentType}.md  (subagentes)
 */
import { envs } from "../envs.js";
import { agentLogger } from "./logger.service.js";
import { buildToolDefinitions, executeToolCall } from "../utils/tools.js";

interface ToolCallbacks {
	onToolCall: (toolName: string, args: any) => Promise<void>;
	draftCallbacks: {
		onUpdate: (draft: string) => Promise<void>;
		onRead: () => Promise<string | null>;
	};
	credentialCallbacks: {
		getCredentials: (mcpServerId: string) => Promise<Record<string, string>>;
		setCredential: (
			mcpServerId: string,
			key: string,
			value: string,
		) => Promise<void>;
		deleteCredential: (mcpServerId: string, key: string) => Promise<void>;
		getListCredentials: () => Promise<
			{
				id: string;
				name: string;
				displayName: string;
				credentialFields: { key: string; description: string }[];
			}[]
		>;
	};
}

interface IAgentServiceExecute {
	systemPrompt?: string; // Permite pasar un prompt personalizado para este agente
	agentSlug: string;
	query: string;
	history?: Array<{ role: "user" | "assistant"; content: string }>;
	allowedTools?: Set<string>; // Lista de herramientas permitidas para este agente
	artifacts?: { name: string; content: string }[];
	stream?: boolean; // Indica si la respuesta debe ser en formato stream
	toolsCallbacks?: ToolCallbacks; // Callbacks para invocar herramientas y manejar borradores
	userId?: string; // ID del usuario que inicia la ejecución (para inyección de credenciales MCP)
	signal?: AbortSignal; // Señal para cancelar la ejecución del agente
}

interface IAgentService {
	// biome-ignore lint/suspicious/noExplicitAny: return type varies per implementation
	executeAgent(params: IAgentServiceExecute): Promise<any>;
}

// ── Local types ───────────────────────────────────────────────────────────────

interface ParsedModel {
	provider: "copilot" | "openai" | "direct";
	model: string;
}

interface RequestConfig {
	baseURL: string;
	headers: Record<string, string>;
	model: string;
	provider: "copilot" | "openai" | "direct";
	sessionId?: string;
}

interface ToolCallAccum {
	/** Output item ID — starts with 'fc_' (used in function_call.id) */
	id: string;
	/** Call reference ID — starts with 'call_' (used in function_call.call_id and function_call_output.call_id) */
	callId: string;
	name: string;
	args: string;
}

interface ToolCall {
	id: string;
	/** call_id used by the Responses API (may differ from id) */
	callId?: string;
	type: "function";
	function: { name: string; arguments: string };
}

interface MessageParam {
	role: "system" | "user" | "assistant" | "tool";
	content: string | null;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
}

interface Tool {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

interface CompletionMessage {
	content: string | null;
	tool_calls?: ToolCall[];
	finish_reason: string;
}

interface TokenResponse {
	id_token: string;
	access_token: string;
	refresh_token: string;
	expires_in?: number;
}

export interface IdTokenClaims {
	chatgpt_account_id?: string;
	organizations?: Array<{ id: string }>;
	email?: string;
	"https://api.openai.com/auth"?: {
		chatgpt_account_id?: string;
	};
}

// ── Context management constants (mirroring OpenCode's prune strategy) ─────────

/**
 * Max chars stored per tool result in message history.
 * OpenCode prunes at ~40k tokens; we use 20k chars (≈5k tokens) per result.
 */
const TOOL_RESULT_IN_HISTORY = 20_000;

/**
 * Chars of RECENT tool results protected from pruning (≈15k tokens).
 * OpenCode's PRUNE_PROTECT = 40_000 tokens ≈ 160k chars; we're more aggressive.
 */
const PRUNE_PROTECT_CHARS = 60_000;

/**
 * Total chars in the messages array that triggers pruning.
 * Corresponds to ~37k tokens — prune before context window fills.
 */
const TOTAL_CHARS_PRUNE_THRESHOLD = 150_000;

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseJwtClaims(token: string): IdTokenClaims | undefined {
	const parts = token.split(".");
	if (parts.length !== 3) return undefined;
	try {
		return JSON.parse(Buffer.from(parts[1], "base64url").toString());
	} catch {
		return undefined;
	}
}

function extractAccountIdFromClaims(claims: IdTokenClaims): string | undefined {
	return (
		claims.chatgpt_account_id ||
		claims["https://api.openai.com/auth"]?.chatgpt_account_id ||
		claims.organizations?.[0]?.id
	);
}

function extractAccountId(tokens: TokenResponse): string | undefined {
	if (tokens.id_token) {
		const claims = parseJwtClaims(tokens.id_token);
		const accountId = claims && extractAccountIdFromClaims(claims);
		if (accountId) return accountId;
	}
	if (tokens.access_token) {
		const claims = parseJwtClaims(tokens.access_token);
		return claims ? extractAccountIdFromClaims(claims) : undefined;
	}
	return undefined;
}

/** Extract body after YAML frontmatter (`---`) */
function stripFrontmatter(content: string): string {
	return content.replace(/^---[\s\S]*?---\s*\n/, "").trim();
}

/**
 * Parse the YAML frontmatter block of an agent .md file and return the set of
 * allowed tool names (where value === true).  Returns null if no tools section
 * is present, meaning "all tools allowed".
 */
function parseFrontmatterTools(content: string): Set<string> | null {
	const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
	if (!match) return null;

	const yaml = match[1];
	const toolsMatch = yaml.match(/^tools:\s*\n((?:[ \t]+\S.*\n?)*)/m);
	if (!toolsMatch) return null;

	const toolLines = toolsMatch[1];
	const allowed = new Set<string>();
	for (const line of toolLines.split("\n")) {
		const m = line.match(/^\s+([\w_-]+)\s*:\s*(true|false)\s*$/);
		if (m && m[2] === "true") {
			allowed.add(m[1]);
		}
	}
	return allowed.size > 0 ? allowed : null;
}

// ── InternalAgentService ──────────────────────────────────────────────────────

export class InternalAgentService implements IAgentService {
	/** Parse AGENT_MODEL string into provider + model name */
	private parseModel(agentModel: string): ParsedModel {
		const lower = agentModel.toLowerCase();

		if (lower.startsWith("copilot/") || lower.startsWith("github-copilot/")) {
			const slash = agentModel.indexOf("/");
			return { provider: "copilot", model: agentModel.slice(slash + 1) };
		}

		if (lower.startsWith("openai/")) {
			return { provider: "openai", model: agentModel.slice(7) };
		}

		return { provider: "direct", model: agentModel || "gpt-4o" };
	}

	/** Build fetch request config based on the parsed provider */
	private buildRequestConfig(parsed: ParsedModel): RequestConfig {
		if (parsed.provider === "copilot") {
			return {
				baseURL: "https://api.githubcopilot.com",
				headers: {
					"content-type": "application/json",
					"x-initiator": "agent",
					"user-agent":
						"opencode/local ai-sdk/provider-utils/3.0.21 runtime/bun/1.3.9",
					"User-Agent": "opencode/local",
					"Openai-Intent": "conversation-edits",
				},
				model: parsed.model,
				provider: "copilot",
			};
		}

		if (parsed.provider === "openai") {
			return {
				baseURL: "https://chatgpt.com/backend-api/codex/responses",
				headers: {},
				model: parsed.model,
				provider: "openai",
				sessionId: "",
			};
		}

		// "direct" — use CHAT_* env vars
		const headers: Record<string, string> = {
			"content-type": "application/json",
			"x-initiator": "agent",
			"user-agent": "opencode/local",
			"Openai-Intent": "conversation-edits",
		};

		return {
			baseURL: envs.AGENT_BASE_URL || "https://api.openai.com/v1",
			headers,
			model: parsed.model,
			provider: "direct",
		};
	}

	/**
	 * Convert internal MessageParam[] to the Responses API `input` array +
	 * extract `instructions` from the system message.
	 */
	private buildCodexBody(
		config: RequestConfig,
		messages: MessageParam[],
		tools?: Tool[],
	): Record<string, unknown> {
		let instructions = "";
		const input: unknown[] = [];

		for (const msg of messages) {
			if (msg.role === "system") {
				instructions = msg.content ?? "";
				continue;
			}

			if (msg.role === "user") {
				input.push({
					role: "user",
					content: [{ type: "input_text", text: msg.content ?? "" }],
				});
				continue;
			}

			if (msg.role === "assistant") {
				if (msg.tool_calls?.length) {
					for (const tc of msg.tool_calls) {
						// id must start with 'fc_'; call_id is the tool-call reference
						const outputId = tc.id.startsWith("fc") ? tc.id : `fc_${tc.id}`;
						const callId = tc.callId ?? tc.id;
						input.push({
							type: "function_call",
							id: outputId,
							call_id: callId,
							name: tc.function.name,
							arguments: tc.function.arguments,
						});
					}
				} else if (msg.content) {
					input.push({
						role: "assistant",
						content: [{ type: "output_text", text: msg.content }],
					});
				}
				continue;
			}

			if (msg.role === "tool") {
				// tool_call_id stores the callId (call_... value) from the original ToolCall
				input.push({
					type: "function_call_output",
					call_id: msg.tool_call_id,
					output: msg.content ?? "",
				});
			}
		}

		// Flatten tool definitions to Responses API format (not nested under `function`)
		const flatTools = tools?.map((t) => ({
			type: "function",
			name: t.function.name,
			description: t.function.description,
			parameters: t.function.parameters,
			strict: false,
		}));

		return {
			model: config.model,
			input,
			store: false,
			instructions,
			include: ["reasoning.encrypted_content"],
			prompt_cache_key: config.sessionId,
			reasoning: { effort: "medium", summary: "auto" },
			tools: flatTools,
			tool_choice: "auto",
			stream: true,
		};
	}

	/**
	 * POST to the OpenAI Responses API (codex) and parse its SSE stream.
	 * The URL is `config.baseURL` directly (no `/chat/completions` path appended).
	 * SSE event types follow the `response.*` naming convention of the Responses API.
	 */
	private async fetchCompletionCodex(
		config: RequestConfig,
		messages: MessageParam[],
		tools?: Tool[],
	): Promise<CompletionMessage> {
		const body = this.buildCodexBody(config, messages, tools);

		agentLogger.info(
			JSON.stringify({
				url: config.baseURL,
				method: "POST",
				headers: config.headers,
				body: JSON.stringify(body).slice(0, 200),
			}),
		);

		const res = await fetch(config.baseURL, {
			method: "POST",
			headers: config.headers,
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			throw new Error(
				`API error ${res.status} ${res.statusText}: ${await res.text()}`,
			);
		}

		if (!res.body) throw new Error("Response body is null");

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		let content = "";
		// key = output_index; value accumulates call_id, name, args
		const toolCallMap = new Map<number, ToolCallAccum>();
		let finishReason = "stop";
		let done = false;

		while (!done) {
			const { done: streamDone, value } = await reader.read();
			if (streamDone) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed.startsWith("data:")) continue;

				const data = trimmed.slice(5).trim();
				if (data === "[DONE]") {
					done = true;
					break;
				}

				let chunk: Record<string, unknown>;
				try {
					chunk = JSON.parse(data) as Record<string, unknown>;
				} catch {
					continue;
				}

				const eventType = chunk.type as string | undefined;

				if (eventType === "response.output_text.delta") {
					content += (chunk.delta as string) ?? "";
				} else if (eventType === "response.output_item.added") {
					const item = chunk.item as Record<string, unknown> | undefined;
					if (item?.type === "function_call") {
						const outputIndex =
							(chunk.output_index as number) ?? toolCallMap.size;
						const itemId = (item.id as string) ?? "";
						const itemCallId = (item.call_id as string) ?? itemId;
						toolCallMap.set(outputIndex, {
							id: itemId,
							callId: itemCallId,
							name: (item.name as string) ?? "",
							args: "",
						});
					}
				} else if (eventType === "response.function_call_arguments.delta") {
					const idx = (chunk.output_index as number) ?? 0;
					const entry = toolCallMap.get(idx);
					if (entry) entry.args += (chunk.delta as string) ?? "";
				} else if (eventType === "response.completed") {
					done = true;
				} else if (eventType === "error") {
					throw new Error(`Codex API stream error: ${JSON.stringify(chunk)}`);
				}
			}
		}

		const toolCalls: ToolCall[] | undefined =
			toolCallMap.size > 0
				? [...toolCallMap.entries()]
						.sort(([a], [b]) => a - b)
						.map(([, tc]) => ({
							id: tc.id,
							callId: tc.callId,
							type: "function" as const,
							function: { name: tc.name, arguments: tc.args },
						}))
				: undefined;

		if (toolCalls?.length) finishReason = "tool_calls";

		return {
			content: content || null,
			tool_calls: toolCalls,
			finish_reason: finishReason,
		};
	}

	/**
	 * POST to /chat/completions with stream:true and accumulate the full SSE
	 * response into a single CompletionMessage.
	 */
	private async fetchCompletion(
		config: RequestConfig,
		body: Record<string, unknown>,
	): Promise<CompletionMessage> {
		// Route OpenAI Codex / Responses API calls to the dedicated handler
		if (config.provider === "openai") {
			return this.fetchCompletionCodex(
				config,
				body.messages as MessageParam[],
				body.tools as Tool[] | undefined,
			);
		}

		const res = await fetch(`${config.baseURL}/chat/completions`, {
			method: "POST",
			headers: config.headers,
			body: JSON.stringify({ ...body, tool_choice: "auto", stream: true }),
		});

		agentLogger.info(
			JSON.stringify({
				url: `${config.baseURL}/chat/completions`,
				method: "POST",
				headers: config.headers,
				body: JSON.stringify({ ...body, tool_choice: "auto", stream: true }),
			}),
		);

		if (!res.ok) {
			throw new Error(
				`API error ${res.status} ${res.statusText}: ${await res.text()}`,
			);
		}

		if (!res.body) throw new Error("Response body is null");

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		let content = "";
		const toolCallMap = new Map<number, ToolCallAccum>();
		let finishReason = "stop";
		let done = false;

		while (!done) {
			const { done: streamDone, value } = await reader.read();
			if (streamDone) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			// Preserve potentially incomplete last line
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed.startsWith("data:")) continue;

				const data = trimmed.slice(5).trim();
				if (data === "[DONE]") {
					done = true;
					break;
				}

				let chunk: Record<string, unknown>;
				try {
					chunk = JSON.parse(data) as Record<string, unknown>;
				} catch {
					continue;
				}

				const choices = chunk.choices as
					| Array<Record<string, unknown>>
					| undefined;
				const choice = choices?.[0];
				if (!choice) continue;

				if (typeof choice.finish_reason === "string" && choice.finish_reason) {
					finishReason = choice.finish_reason;
				}

				const delta = choice.delta as Record<string, unknown> | undefined;
				if (!delta) continue;

				if (typeof delta.content === "string") {
					content += delta.content;
				}

				const tcDeltas = delta.tool_calls as
					| Array<Record<string, unknown>>
					| undefined;
				if (tcDeltas) {
					for (const tc of tcDeltas) {
						const idx = (tc.index as number) ?? 0;
						if (!toolCallMap.has(idx)) {
							toolCallMap.set(idx, { id: "", callId: "", name: "", args: "" });
						}
						const entry = toolCallMap.get(idx) as ToolCallAccum;
						if (tc.id) {
							entry.id = tc.id as string;
							entry.callId = tc.id as string;
						}
						const fn = tc.function as Record<string, string> | undefined;
						if (fn?.name) entry.name = fn.name;
						if (fn?.arguments) entry.args += fn.arguments;
					}
				}
			}
		}

		const toolCalls: ToolCall[] | undefined =
			toolCallMap.size > 0
				? [...toolCallMap.entries()]
						.sort(([a], [b]) => a - b)
						.map(([, tc]) => ({
							id: tc.id,
							type: "function" as const,
							function: { name: tc.name, arguments: tc.args },
						}))
				: undefined;

		return {
			content: content || null,
			tool_calls: toolCalls,
			finish_reason: finishReason,
		};
	}

	/**
	 * Like fetchCompletion but yields content string deltas in real-time.
	 * Returns the complete CompletionMessage as the generator return value.
	 * Handles both chat/completions (copilot/direct) and Responses API (openai/codex).
	 */
	private async *fetchCompletionStream(
		config: RequestConfig,
		body: Record<string, unknown>,
		signal?: AbortSignal,
	): AsyncGenerator<string, CompletionMessage, void> {
		// ── Codex / Responses API ────────────────────────────────────────────
		if (config.provider === "openai") {
			const codexBody = this.buildCodexBody(
				config,
				body.messages as MessageParam[],
				body.tools as Tool[] | undefined,
			);
			const res = await fetch(config.baseURL, {
				method: "POST",
				headers: config.headers,
				body: JSON.stringify(codexBody),
				signal,
			});
			if (!res.ok)
				throw new Error(`API error ${res.status}: ${await res.text()}`);
			if (!res.body) throw new Error("Response body is null");

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let content = "";
			const toolCallMap = new Map<number, ToolCallAccum>();
			let finishReason = "stop";
			let done = false;

			while (!done) {
				const { done: streamDone, value } = await reader.read();
				if (streamDone) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed.startsWith("data:")) continue;
					const data = trimmed.slice(5).trim();
					if (data === "[DONE]") {
						done = true;
						break;
					}
					let chunk: Record<string, unknown>;
					try {
						chunk = JSON.parse(data) as Record<string, unknown>;
					} catch {
						continue;
					}
					const eventType = chunk.type as string | undefined;
					if (eventType === "response.output_text.delta") {
						const delta = (chunk.delta as string) ?? "";
						content += delta;
						if (delta) yield delta;
					} else if (eventType === "response.output_item.added") {
						const item = chunk.item as Record<string, unknown> | undefined;
						if (item?.type === "function_call") {
							const outputIndex =
								(chunk.output_index as number) ?? toolCallMap.size;
							const itemId = (item.id as string) ?? "";
							toolCallMap.set(outputIndex, {
								id: itemId,
								callId: (item.call_id as string) ?? itemId,
								name: (item.name as string) ?? "",
								args: "",
							});
						}
					} else if (eventType === "response.function_call_arguments.delta") {
						const idx = (chunk.output_index as number) ?? 0;
						const entry = toolCallMap.get(idx);
						if (entry) entry.args += (chunk.delta as string) ?? "";
					} else if (eventType === "response.completed") {
						done = true;
					} else if (eventType === "error") {
						throw new Error(`Codex stream error: ${JSON.stringify(chunk)}`);
					}
				}
			}

			const codexToolCalls: ToolCall[] | undefined =
				toolCallMap.size > 0
					? [...toolCallMap.entries()]
							.sort(([a], [b]) => a - b)
							.map(([, tc]) => ({
								id: tc.id,
								callId: tc.callId,
								type: "function" as const,
								function: { name: tc.name, arguments: tc.args },
							}))
					: undefined;
			if (codexToolCalls?.length) finishReason = "tool_calls";
			return {
				content: content || null,
				tool_calls: codexToolCalls,
				finish_reason: finishReason,
			};
		}

		// ── Standard chat/completions ─────────────────────────────────────────
		const res = await fetch(`${config.baseURL}/chat/completions`, {
			method: "POST",
			headers: config.headers,
			body: JSON.stringify({
				...body,
				tool_choice: "auto",
				stream: true,
				cache_prompt: true,
			}),
			signal,
		});
		if (!res.ok)
			throw new Error(
				`API error ${res.status} ${res.statusText}: ${await res.text()}`,
			);
		if (!res.body) throw new Error("Response body is null");

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let content = "";
		const toolCallMap = new Map<number, ToolCallAccum>();
		let finishReason = "stop";
		let done = false;

		while (!done) {
			const { done: streamDone, value } = await reader.read();
			if (streamDone) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed.startsWith("data:")) continue;
				const data = trimmed.slice(5).trim();
				if (data === "[DONE]") {
					done = true;
					break;
				}
				let chunk: Record<string, unknown>;
				try {
					chunk = JSON.parse(data) as Record<string, unknown>;
				} catch {
					continue;
				}
				const choices = chunk.choices as
					| Array<Record<string, unknown>>
					| undefined;
				const choice = choices?.[0];
				if (!choice) continue;
				if (typeof choice.finish_reason === "string" && choice.finish_reason)
					finishReason = choice.finish_reason;
				const delta = choice.delta as Record<string, unknown> | undefined;
				if (!delta) continue;
				if (typeof delta.content === "string" && delta.content) {
					content += delta.content;
					yield delta.content;
				}
				const tcDeltas = delta.tool_calls as
					| Array<Record<string, unknown>>
					| undefined;
				if (tcDeltas) {
					for (const tc of tcDeltas) {
						const idx = (tc.index as number) ?? 0;
						if (!toolCallMap.has(idx))
							toolCallMap.set(idx, { id: "", callId: "", name: "", args: "" });
						const entry = toolCallMap.get(idx) as ToolCallAccum;
						if (tc.id) {
							entry.id = tc.id as string;
							entry.callId = tc.id as string;
						}
						const fn = tc.function as Record<string, string> | undefined;
						if (fn?.name) entry.name = fn.name;
						if (fn?.arguments) entry.args += fn.arguments;
					}
				}
			}
		}

		const toolCalls: ToolCall[] | undefined =
			toolCallMap.size > 0
				? [...toolCallMap.entries()]
						.sort(([a], [b]) => a - b)
						.map(([, tc]) => ({
							id: tc.id,
							type: "function" as const,
							function: { name: tc.name, arguments: tc.args },
						}))
				: undefined;
		return {
			content: content || null,
			tool_calls: toolCalls,
			finish_reason: finishReason,
		};
	}

	/**
	 * Cap a raw tool result to TOOL_RESULT_IN_HISTORY chars before storing in
	 * message history. Long results (file reads, grep output) are the primary
	 * source of context bloat — mirrors OpenCode's per-part size limit.
	 */
	private capForHistory(result: string): string {
		if (result.length <= TOOL_RESULT_IN_HISTORY) return result;
		return `${result.slice(0, TOOL_RESULT_IN_HISTORY)}\n…[truncated — ${result.length} total chars]`;
	}

	/**
	 * Prune old tool results in-place when total context grows too large.
	 * Inspired by OpenCode's prune() in compaction.ts:
	 *   — Walk backwards accumulating tool-result size.
	 *   — Protect the last PRUNE_PROTECT_CHARS worth of recent tool outputs.
	 *   — Replace older ones with a lightweight placeholder.
	 */
	private pruneMessages(messages: MessageParam[]): void {
		const totalChars = messages.reduce(
			(sum, m) => sum + (m.content?.length ?? 0),
			0,
		);
		if (totalChars <= TOTAL_CHARS_PRUNE_THRESHOLD) return;

		let recentChars = 0;
		let pruned = 0;

		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role !== "tool") continue;
			const len = m.content?.length ?? 0;
			if (recentChars < PRUNE_PROTECT_CHARS) {
				recentChars += len;
			} else {
				messages[i] = { ...m, content: `[context pruned — was ${len} chars]` };
				pruned++;
			}
		}

		if (pruned > 0) {
			agentLogger.info(
				`[InternalAgent] Pruned ${pruned} old tool results (context was ${totalChars} chars)`,
			);
		}
	}

	/** Core agentic loop — iterates until the model stops calling tools */
	private async runLoop(
		parsed: ParsedModel,
		config: RequestConfig,
		messages: MessageParam[],
		tools: Tool[],
		originalParams: IAgentServiceExecute,
		maxIterations = 60,
	): Promise<string> {
		for (let i = 0; i < maxIterations; i++) {
			agentLogger.info(`[InternalAgent] Iteration ${i + 1}/${maxIterations}`);

			// Prune old tool results before sending to avoid context explosion.
			// Mirrors OpenCode's prune() strategy: keep recent tool outputs intact,
			// replace older ones with placeholders.
			this.pruneMessages(messages);

			const msg = await this.fetchCompletion(config, {
				model: config.model,
				temperature: 0.2,
				messages,
				tools,
				tool_choice: "auto",
			});

			messages.push({
				role: "assistant",
				content: null,
				tool_calls: msg.tool_calls,
			});

			agentLogger.info(
				`[InternalAgent] finish_reason=${msg.finish_reason} tool_calls=${msg.tool_calls?.length ?? 0}`,
			);

			if (msg.finish_reason === "stop" || !msg.tool_calls?.length) {
				return msg.content ?? "(no content)";
			}

			for (const toolCall of msg.tool_calls) {
				let toolArgs: Record<string, unknown> = {};
				try {
					toolArgs = JSON.parse(toolCall.function.arguments) as Record<
						string,
						unknown
					>;
				} catch {
					// malformed JSON — pass empty args
				}

				agentLogger.info(
					`[InternalAgent] → ${toolCall.function.name}(${JSON.stringify(toolArgs).slice(0, 200)})`,
				);

				const result = await executeToolCall(
					() => new InternalAgentService(),
					toolCall.function.name,
					toolArgs,
					originalParams,
				);

				agentLogger.info(
					`[InternalAgent] ← ${result.slice(0, 200).replace(/\n/g, "\\n").replace(/\r/g, "\\r")}`,
				);

				// Cap large results before storing in history to prevent
				// per-iteration context bloat (same pattern as OpenCode).
				messages.push({
					role: "tool",
					// For Responses API, callId is the 'call_...' reference; fall back to id
					tool_call_id: toolCall.callId ?? toolCall.id,
					content: this.capForHistory(result),
				});
			}
		}

		return "[InternalAgent] Reached maximum iterations.";
	}

	/** Core agentic loop — streams content deltas and tool progress in real-time */
	private async *runLoopStream(
		parsed: ParsedModel,
		config: RequestConfig,
		messages: MessageParam[],
		tools: Tool[],
		originalParams: IAgentServiceExecute,
		maxIterations = 60,
	): AsyncGenerator<string> {
		const signal = originalParams.signal;
		for (let i = 0; i < maxIterations; i++) {
			if (signal?.aborted) return;
			agentLogger.info(
				`[InternalAgent] Stream iteration ${i + 1}/${maxIterations}`,
			);
			this.pruneMessages(messages);

			const body = {
				model: config.model,
				temperature: 0.2,
				messages,
				tools,
				tool_choice: "auto",
			};

			// Consume the streaming generator, forwarding content deltas to caller
			const gen = this.fetchCompletionStream(config, body, signal);
			let iterResult = await gen.next();
			while (!iterResult.done) {
				yield iterResult.value;
				iterResult = await gen.next();
			}
			const msg = iterResult.value;

			messages.push({
				role: "assistant",
				content: msg.content,
				tool_calls: msg.tool_calls,
			});

			agentLogger.info(
				`[InternalAgent] finish_reason=${msg.finish_reason} tool_calls=${msg.tool_calls?.length ?? 0}`,
			);

			if (msg.finish_reason === "stop" || !msg.tool_calls?.length) {
				if (!msg.content) yield "(no content)";
				return;
			}

			for (const toolCall of msg.tool_calls) {
				let toolArgs: Record<string, unknown> = {};
				try {
					toolArgs = JSON.parse(toolCall.function.arguments) as Record<
						string,
						unknown
					>;
				} catch {
					// malformed JSON — pass empty args
				}

				agentLogger.info(
					`[InternalAgent] → ${toolCall.function.name}(${JSON.stringify(toolArgs).slice(0, 200)})`,
				);

				const result = await executeToolCall(
					() => new InternalAgentService(),
					toolCall.function.name,
					toolArgs,
					originalParams,
				);

				agentLogger.info(
					`[InternalAgent] ← ${result.slice(0, 200).replace(/\n/g, "\\n").replace(/\r/g, "\\r")}`,
				);

				messages.push({
					role: "tool",
					tool_call_id: toolCall.callId ?? toolCall.id,
					content: this.capForHistory(result),
				});
			}
		}

		yield "[InternalAgent] Reached maximum iterations.";
	}

	// ── Public API ────────────────────────────────────────────────────────────

	async executeAgent(params: IAgentServiceExecute): Promise<unknown> {
		const {
			query,
			agentSlug: agentType,
			systemPrompt,
			allowedTools,
			toolsCallbacks,
		} = params;

		agentLogger.info(`[InternalAgent] ══════ START agent=${agentType} ══════`);
		agentLogger.info(`[InternalAgent] model=${envs.AGENT_MODEL}`);
		agentLogger.info(`[InternalAgent] query=${query.slice(0, 120)}`);

		const parsed = this.parseModel(envs.AGENT_MODEL);
		const config = this.buildRequestConfig(parsed);

		const tools = buildToolDefinitions(
			allowedTools ?? undefined,
			toolsCallbacks,
		);

		const messages: MessageParam[] = [
			{ role: "system", content: systemPrompt || "" },
			{ role: "user", content: query },
		];

		try {
			const result = await this.runLoop(
				parsed,
				config,
				messages,
				tools,
				params,
				60,
			);
			agentLogger.info(`[InternalAgent] ══════ END agent=${agentType} ══════`);
			return result;
		} finally {
			agentLogger.info(
				`[InternalAgent] ══════ END stream agent=${agentType} ══════`,
			);
		}
	}

	/** Streaming variant of executeAgent — yields content deltas and tool progress as they arrive */
	async *executeAgentStream(
		params: IAgentServiceExecute,
	): AsyncGenerator<string> {
		const {
			query,
			agentSlug: agentType,
			artifacts,
			history,
			systemPrompt,
			allowedTools,
			toolsCallbacks,
		} = params;

		agentLogger.info(
			`[InternalAgent] ══════ START stream agent=${agentType} ══════`,
		);
		agentLogger.info(`[InternalAgent] model=${envs.AGENT_MODEL}`);
		agentLogger.info(`[InternalAgent] query=${query.slice(0, 120)}`);

		const parsed = this.parseModel(envs.AGENT_MODEL);
		const config = this.buildRequestConfig(parsed);

		const tools = buildToolDefinitions(
			allowedTools ?? undefined,
			toolsCallbacks,
		);

		let userContent = query;
		if (artifacts?.length) {
			const artifactBlock = artifacts
				.map((a) => `### Artifact: ${a.name}\n\`\`\`\n${a.content}\n\`\`\``)
				.join("\n\n");
			userContent = `${query}\n\n---\n## Context artifacts\n${artifactBlock}`;
		}

		const messages: MessageParam[] = [
			{ role: "system", content: systemPrompt || "" },
			...(history?.map((h) => ({ role: h.role, content: h.content })) ?? []),
			{ role: "user", content: userContent },
		];

		try {
			yield* this.runLoopStream(parsed, config, messages, tools, params, 60);
		} finally {
			agentLogger.info(
				`[InternalAgent] ══════ END stream agent=${agentType} ══════`,
			);
		}
	}
}
