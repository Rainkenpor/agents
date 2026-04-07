import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import puppeteer from "puppeteer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
	type AutomationPlan,
	type AutomationStep,
	type StepContext,
	sessions,
	ok,
	err,
} from "./types.ts";
import type { Frame, KeyInput, Page, ElementHandle } from "puppeteer";

// ─── Generador de IDs de sesión ────────────────────────────────────────────────

function generateSessionId(): string {
	return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Compatibilidad de selectores Playwright → Puppeteer ──────────────────────
// Puppeteer usa querySelectorAll nativo, que no entiende pseudo-selectores de
// Playwright como :text-matches() o :text(). Esta función los traduce.

async function queryAllCompat(
	target: Page | Frame,
	selector: string,
): Promise<ElementHandle[]> {
	// :text-matches('pattern', 'flags')  →  filtro manual por textContent
	const textMatchRe =
		/^(.*?):text-matches\(['"](.+?)['"]\s*(?:,\s*['"](.+?)['"]\s*)?\)$/;
	const m = selector.match(textMatchRe);
	if (m) {
		const baseSelector = m[1].trim() || "*";
		const pattern = m[2];
		const flags = m[3] ?? "";
		const elements = await target.$$(baseSelector);
		const regex = new RegExp(pattern, flags);
		const matched: ElementHandle[] = [];
		for (const el of elements) {
			const text = await el.evaluate((e: Element) => e.textContent ?? "");
			if (regex.test(text.trim())) matched.push(el);
		}
		return matched;
	}
	return target.$$(selector);
}

// ─── Ejecutor de pasos JSON ────────────────────────────────────────────────────

async function runStep(step: AutomationStep, ctx: StepContext): Promise<void> {
	const { page } = ctx;

	console.log(
		`Ejecutando paso: ${step.action} ${step.selector ?? ""} ${step.url ?? ""}`,
	);
	switch (step.action) {
		case "goto":
			await page.goto(step.url!);
			break;

		case "waitForSelector": {
			const target = step.inFrame && ctx.targetFrame ? ctx.targetFrame : page;
			const stateOpts =
				step.state === "visible"
					? { visible: true as const }
					: step.state === "hidden" || step.state === "detached"
						? { hidden: true as const }
						: {};
			await target.waitForSelector(step.selector!, {
				...stateOpts,
				timeout: step.timeout ?? 30000,
			});
			break;
		}

		case "waitForTimeout":
			await new Promise<void>((r) => setTimeout(r, step.ms ?? 1000));
			break;

		case "click": {
			const elements = await page.$$(step.selector!);
			const el = step.nth !== undefined ? elements[step.nth] : elements[0];
			if (el) await el.click(step.options as Parameters<typeof el.click>[0]);
			break;
		}

		case "fill":
			await page.locator(step.selector!).fill(step.value ?? "");
			break;

		case "type":
			await page.keyboard.type(step.text ?? "");
			break;

		case "press":
			await page.keyboard.press((step.key ?? "Enter") as KeyInput);
			break;

		case "findPluginFrame": {
			const retries = step.retries ?? 15;
			const delay = step.retryDelay ?? 2000;
			const selectors = step.frameSelectors ?? [];
			let found: Frame | null = null;

			for (let i = 0; i < retries; i++) {
				for (const frame of page.frames()) {
					for (const sel of selectors) {
						const count = (await queryAllCompat(frame, sel)).length;
						if (count > 0) {
							found = frame;
							break;
						}
					}
					if (found) break;
				}
				if (found) break;
				await new Promise<void>((r) => setTimeout(r, delay));
			}

			ctx.targetFrame = found;
			if (!found) {
				throw new Error("Timeout: No se pudo localizar el iframe del plugin.");
			}
			break;
		}

		case "clickIfVisible": {
			const frame = step.inFrame && ctx.targetFrame ? ctx.targetFrame : null;
			const base = frame ?? page;
			const elements = await base.$$(step.selector!);
			for (const el of elements) {
				if (step.hasText) {
					const text = await el.evaluate((e: Element) => e.textContent ?? "");
					if (!new RegExp(step.hasText, "i").test(text)) continue;
				}
				const visible = await el.isIntersectingViewport();
				if (visible) {
					await el.click();
					break;
				}
			}
			break;
		}

		case "getText": {
			const frame = step.inFrame && ctx.targetFrame ? ctx.targetFrame : null;
			const base = frame ?? page;
			const text = await base.$eval(
				step.selector!,
				(el: Element) => (el as HTMLElement).innerText,
			);
			if (step.outputKey) ctx.outputs[step.outputKey] = text.trim();
			break;
		}

		case "close":
			await page.close();
			break;

		default:
			throw new Error(`Acción desconocida: "${step.action}"`);
	}
}

// ─── Limpieza automática de sesiones cerradas ──────────────────────────────────

const CLOSED_SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutos

setInterval(() => {
	const cutoff = Date.now() - CLOSED_SESSION_TTL_MS;
	for (const [id, session] of sessions) {
		if (session.status === "closed" && session.updatedAt.getTime() < cutoff) {
			sessions.delete(id);
		}
	}
}, 60_000);

// ─── Registro de tools MCP ─────────────────────────────────────────────────────

export function registerTools(
	s: McpServer,
	/** Args extraídos de headers x-arg-* en el request HTTP */
	headerArgs: Record<string, string> = {},
): void {
	// ══════════════════════════════════════════════════════════════════════════
	// TOOL: playwright_login
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"playwright_init",
		"Crea una nueva sesión de Puppeteer: lanza el navegador y devuelve un sessionId. El script ejecutado con playwright_execute se encargará de navegar y autenticarse.",
		{
			headless: z
				.boolean()
				.default(false)
				.describe("Ejecutar el navegador sin UI (default: false)"),
		},
		async ({ headless }) => {
			try {
				const browser = await puppeteer.launch({ headless: false });
				const page = await browser.newPage();

				const id = generateSessionId();
				const now = new Date();
				sessions.set(id, {
					id,
					browser,
					page,
					lastScript: null,
					createdAt: now,
					updatedAt: now,
					status: "active",
				});

				// Marcar sesión como cerrada si el navegador o la página se cierran externamente
				browser.on("disconnected", () => {
					const session = sessions.get(id);
					if (session && session.status === "active") {
						session.status = "closed";
						session.updatedAt = new Date();
					}
				});
				page.on("close", () => {
					const session = sessions.get(id);
					if (session && session.status === "active") {
						session.status = "closed";
						session.updatedAt = new Date();
					}
				});

				return ok({ sessionId: id, status: "ready" });
			} catch (e) {
				return err(`Error al crear sesión: ${String(e)}`);
			}
		},
	);

	// ══════════════════════════════════════════════════════════════════════════
	// TOOL: playwright_execute
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"playwright_execute",
		"Ejecuta un script de automatización sobre una sesión activa. Carga el archivo scripts/{name}.json, reemplaza los placeholders <<campo>> con los args proporcionados y ejecuta los pasos. Devuelve los valores capturados con outputKey.",
		{
			session_id: z
				.string()
				.describe("ID de sesión devuelto por playwright_login"),
			name: z
				.string()
				.describe(
					'Nombre del script en la carpeta scripts/ sin extensión (ej: "figma")',
				),
			values: z
				.record(z.string())
				.describe(
					"Argumentos requeridos por el script. Las claves deben coincidir con los campos definidos en el campo 'required' del JSON.",
				),
		},
		async ({ session_id, name, values }) => {
			const session = sessions.get(session_id);
			if (!session) return err(`Sesión no encontrada: ${session_id}`);
			if (session.status === "closed")
				return err(`La sesión ${session_id} ya fue cerrada.`);

			// ── Merge: headerArgs como base, args del body tienen prioridad ───────
			const resolvedArgs = { ...headerArgs, ...values };

			// ── Cargar script ────────────────────────────────────────────────────
			const scriptPath = resolve(`./scripts/${name}.json`);
			let rawScript: string;
			try {
				rawScript = await readFile(scriptPath, "utf-8");
			} catch {
				return err(
					`Script no encontrado: scripts/${name}.json. Verifica que el archivo exista.`,
				);
			}

			// ── Parsear para validar required antes de reemplazar ────────────────
			let parsed: AutomationPlan & { required?: Record<string, string> };
			try {
				parsed = JSON.parse(rawScript);
			} catch {
				return err(`El script scripts/${name}.json no es un JSON válido.`);
			}

			// ── Validar que todos los required estén en resolvedArgs ─────────────
			if (parsed.required) {
				const missing = Object.keys(parsed.required).filter(
					(k) => !(k in resolvedArgs),
				);
				if (missing.length > 0) {
					return err(`Faltan argumentos requeridos: ${missing.join(", ")}.`);
				}
			}

			// ── Reemplazar placeholders <<campo>> en el JSON crudo ───────────────
			let processed = rawScript;
			for (const [key, value] of Object.entries(resolvedArgs)) {
				processed = processed.replaceAll(
					`<<${key}>>`,
					value.replace(/"/g, '\\"'),
				);
			}

			const automation: AutomationPlan = JSON.parse(processed);

			// ── Ejecutar pasos ───────────────────────────────────────────────────
			const ctx: StepContext = {
				page: session.page,
				targetFrame: null,
				outputs: {},
			};

			try {
				for (const step of automation.steps) {
					await runStep(step, ctx);
				}
				session.lastScript = name;
				session.updatedAt = new Date();
				return ok({ status: "completed", script: name, outputs: ctx.outputs });
			} catch (e) {
				session.lastScript = name;
				session.updatedAt = new Date();
				return err(`Error ejecutando "${name}": ${(e as Error).message}`);
			}
		},
	);

	// ══════════════════════════════════════════════════════════════════════════
	// TOOL: playwright_close
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"playwright_close",
		"Cierra el navegador de una sesión activa de Puppeteer y la marca como cerrada.",
		{
			session_id: z.string().describe("ID de la sesión a cerrar"),
		},
		async ({ session_id }) => {
			const session = sessions.get(session_id);
			if (!session) return err(`Sesión no encontrada: ${session_id}`);
			if (session.status === "closed")
				return ok({ sessionId: session_id, status: "already_closed" });

			try {
				await session.browser.close();
			} catch {
				// El navegador puede ya haber sido cerrado externamente
			}

			session.status = "closed";
			session.updatedAt = new Date();

			return ok({ sessionId: session_id, status: "closed" });
		},
	);

	// ══════════════════════════════════════════════════════════════════════════
	// TOOL: playwright_list_sessions
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"playwright_list_sessions",
		"Lista todas las sesiones de Puppeteer registradas en el servidor, mostrando su estado y la última vez que fueron actualizadas.",
		{},
		async () => {
			if (sessions.size === 0) {
				return ok({ sessions: [], total: 0 });
			}

			const list = [...sessions.values()].map((s) => ({
				id: s.id,
				status: s.status,
				lastScript: s.lastScript ?? "(sin ejecutar)",
				createdAt: s.createdAt.toISOString(),
				updatedAt: s.updatedAt.toISOString(),
				lastUpdatedAgo: formatAgo(s.updatedAt),
			}));

			list.sort(
				(a, b) =>
					new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
			);

			return ok({ sessions: list, total: list.length });
		},
	);
}

// ─── Utilidad: tiempo relativo ─────────────────────────────────────────────────

function formatAgo(date: Date): string {
	const diffMs = Date.now() - date.getTime();
	const s = Math.floor(diffMs / 1000);
	if (s < 60) return `hace ${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `hace ${m}m`;
	const h = Math.floor(m / 60);
	if (h < 24) return `hace ${h}h`;
	return `hace ${Math.floor(h / 24)}d`;
}
