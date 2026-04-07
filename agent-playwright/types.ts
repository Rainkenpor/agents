import type { Browser, Page, Frame } from "puppeteer";

// ─── Sesión Playwright ─────────────────────────────────────────────────────────

export interface PlaywrightSession {
	id: string;
	browser: Browser;
	page: Page;
	/** Último script ejecutado en esta sesión */
	lastScript: string | null;
	createdAt: Date;
	updatedAt: Date;
	status: "active" | "closed";
}

/** Store global de sesiones (vive mientras el servidor esté corriendo) */
export const sessions = new Map<string, PlaywrightSession>();

// ─── Formato JSON de automatización ───────────────────────────────────────────

export interface AutomationStep {
	action: string;
	// goto
	url?: string;
	// waitForSelector
	selector?: string;
	state?: "visible" | "hidden" | "attached" | "detached";
	timeout?: number;
	// waitForTimeout
	ms?: number;
	// click
	options?: Record<string, unknown>;
	nth?: number;
	// fill / type
	value?: string;
	text?: string;
	// press
	key?: string;
	// findPluginFrame
	retries?: number;
	retryDelay?: number;
	frameSelectors?: string[];
	// clickIfVisible / waitForSelector / getText
	hasText?: string;
	inFrame?: boolean;
	// getText
	outputKey?: string;
}

export interface AutomationPlan {
	/** Campos requeridos del script. Clave = nombre del placeholder, valor = descripción */
	required?: Record<string, string>;
	browser?: { type?: string; headless?: boolean };
	steps: AutomationStep[];
}

// ─── Contexto de ejecución de pasos ───────────────────────────────────────────

export interface StepContext {
	page: Page;
	targetFrame: Frame | null;
	outputs: Record<string, string>;
}

// ─── Helpers de respuesta MCP ──────────────────────────────────────────────────

export const ok = (data: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

export const err = (message: string) => ({
	isError: true,
	content: [
		{
			type: "text" as const,
			text: JSON.stringify({ error: message }, null, 2),
		},
	],
});
