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
import nodePath from "node:path";
import { agentLogger } from "./utils/logger.ts";
import {
	buildToolDefinitions,
	executeToolCall,
	type IAgentServiceExecute,
	type IAgentService,
} from "./utils/tools.js";

// Alerta si no esta configurado AGENT_MODEL, ya que es esencial para el funcionamiento del agente
if (!process.env.AGENT_BASE_URL)
	agentLogger.warn("AGENT_BASE_URL is not configured");
if (!process.env.AGENT_MODEL) agentLogger.warn("AGENT_MODEL is not configured");

const envs = {
	AGENT_MODEL: process.env.AGENT_MODEL || "gpt-4o",
	AGENT_BASE_URL: process.env.AGENT_BASE_URL,
};

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

// ── InternalAgentService ──────────────────────────────────────────────────────

export class InternalAgentService implements IAgentService {
	private agentType = "";

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
			`[${this.agentType}] POST ${config.baseURL} with body: ${JSON.stringify(body)}`,
		);

		const res = await fetch(config.baseURL, {
			method: "POST",
			headers: config.headers,
			body: JSON.stringify(body),
			// timeout
			signal: AbortSignal.timeout(3600000),
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
			// timeout
			signal: AbortSignal.timeout(3600000),
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
				// timeout
				signal: AbortSignal.timeout(3600000),
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
			body: JSON.stringify({ ...body, tool_choice: "auto", stream: true }),
			// timeout
			signal: AbortSignal.timeout(3600000),
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
				`[${this.agentType}] Pruned ${pruned} old tool results (context was ${totalChars} chars)`,
			);
		}
	}

	/** Core agentic loop — iterates until the model stops calling tools */
	private async runLoop(
		parsed: ParsedModel,
		config: RequestConfig,
		messages: MessageParam[],
		tools: Tool[],
		basePath: string,
		originalParams: IAgentServiceExecute,
		maxIterations = 60,
	): Promise<string> {
		try {
			for (let i = 0; i < maxIterations; i++) {
				agentLogger.info(
					`[${this.agentType}] Iteration ${i + 1}/${maxIterations}`,
				);

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
					`[${this.agentType}] finish_reason=${msg.finish_reason} tool_calls=${msg.tool_calls?.length ?? 0}`,
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
						`[${this.agentType}] → ${toolCall.function.name}(${JSON.stringify(toolArgs).slice(0, 200)})`,
					);

					const result = await executeToolCall(
						() => new InternalAgentService(),
						toolCall.function.name,
						toolArgs,
						basePath,
						originalParams,
					);

					agentLogger.info(
						`[${this.agentType}] ← ${result.slice(0, 200).replace(/\n/g, "\\n").replace(/\r/g, "\\r")}`,
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
		} catch (error) {
			return `[${this.agentType}] Error: ${(error as Error).message}`;
		}

		return `[${this.agentType}] Reached maximum iterations.`;
	}

	/** Core agentic loop — streams content deltas and tool progress in real-time */
	private async *runLoopStream(
		parsed: ParsedModel,
		config: RequestConfig,
		messages: MessageParam[],
		tools: Tool[],
		basePath: string,
		originalParams: IAgentServiceExecute,
		maxIterations = 60,
	): AsyncGenerator<string> {
		for (let i = 0; i < maxIterations; i++) {
			agentLogger.info(
				`[${this.agentType}] Stream iteration ${i + 1}/${maxIterations}`,
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
			const gen = this.fetchCompletionStream(config, body);
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
				`[${this.agentType}] finish_reason=${msg.finish_reason} tool_calls=${msg.tool_calls?.length ?? 0}`,
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

				const id =
					new Date().getTime().toString(36) +
					Math.random().toString(36).slice(2);

				// Yield visible progress so the user sees tool activity
				yield `<<${id}::${toolCall.function.name}>>${JSON.stringify(toolArgs).slice(0, 200)}<<\\${id}>>`;

				agentLogger.info(
					`[${this.agentType}] → ${toolCall.function.name}(${JSON.stringify(toolArgs).slice(0, 200)})`,
				);

				const result = await executeToolCall(
					() => new InternalAgentService(),
					toolCall.function.name,
					toolArgs,
					basePath,
					originalParams,
				);

				yield `<<${id}>>$${result.slice(0, 500)}<<\\${id}>>`;

				agentLogger.info(
					`[${this.agentType}] ← ${result.slice(0, 200).replace(/\n/g, "\\n").replace(/\r/g, "\\r")}`,
				);

				messages.push({
					role: "tool",
					tool_call_id: toolCall.callId ?? toolCall.id,
					content: this.capForHistory(result),
				});
			}
		}

		yield `[${this.agentType}] Reached maximum iterations.`;
	}

	// ── Public API ────────────────────────────────────────────────────────────

	async executeAgent(params: IAgentServiceExecute): Promise<unknown> {
		const { systemPrompt, allowedTools, dirPath, query } = params;

		const basePath = dirPath.startsWith(".")
			? nodePath.join(process.cwd(), dirPath)
			: dirPath;

		agentLogger.info(`[${this.agentType}] ══════ START agent ══════`);
		agentLogger.info(`[${this.agentType}] basePath=${basePath}`);
		agentLogger.info(`[${this.agentType}] model=${envs.AGENT_MODEL}`);
		agentLogger.info(`[${this.agentType}] query=${query.slice(0, 220)}`);

		const parsed = this.parseModel(envs.AGENT_MODEL);
		const config = this.buildRequestConfig(parsed);

		const tools = buildToolDefinitions(allowedTools ?? undefined);

		// Build user message, embedding artifacts inline when present
		const messages: MessageParam[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: query },
		];

		try {
			const result = await this.runLoop(
				parsed,
				config,
				messages,
				tools,
				basePath,
				params,
				60,
			);
			agentLogger.info(`[${this.agentType}] ══════ END agent ══════`);
			agentLogger.info(
				`[${this.agentType}] Final result: ${typeof result === "string" ? result.slice(0, 500) : JSON.stringify(result).slice(0, 500)}`,
			);
			return result;
		} catch (err) {
			agentLogger.error(
				`[${this.agentType}] Error in agent execution: ${(err as Error).message}`,
			);
			throw err;
		} finally {
			agentLogger.info(`[${this.agentType}] ══════ END stream agent ══════`);
		}
	}

	/** Streaming variant of executeAgent — yields content deltas and tool progress as they arrive */
	async *executeAgentStream(
		params: IAgentServiceExecute,
	): AsyncGenerator<string> {
		const { systemPrompt, allowedTools, dirPath, query } = params;

		const basePath = dirPath.startsWith(".")
			? nodePath.join(process.cwd(), dirPath)
			: dirPath;

		agentLogger.info(`[${this.agentType}] ══════ START stream agent ══════`);
		agentLogger.info(`[${this.agentType}] basePath=${basePath}`);
		agentLogger.info(`[${this.agentType}] model=${envs.AGENT_MODEL}`);
		agentLogger.info(`[${this.agentType}] query=${query.slice(0, 120)}`);

		const parsed = this.parseModel(envs.AGENT_MODEL);
		const config = this.buildRequestConfig(parsed);

		const tools = buildToolDefinitions(allowedTools ?? undefined);

		const messages: MessageParam[] = [
			{ role: "system", content: systemPrompt },
			...(history?.map((h) => ({ role: h.role, content: h.content })) ?? []),
			{ role: "user", content: query },
		];

		try {
			yield* this.runLoopStream(
				parsed,
				config,
				messages,
				tools,
				basePath,
				params,
				60,
			);
		} finally {
			agentLogger.info(`[${this.agentType}] ══════ END stream agent ══════`);
		}
	}
}
