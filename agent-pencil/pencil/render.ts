import puppeteer, { type Browser } from "puppeteer";
import { envs } from "../util/envs";
import type { Page, Palette } from "./schema";
import { compileCss } from "./tailwind";

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
	if (!browserPromise) {
		browserPromise = puppeteer.launch({
			headless: true,
			// Only pin a binary when explicitly configured. When unset, Puppeteer
			// resolves its own bundled Chromium (the path it downloaded on install).
			...(envs.PUPPETEER_EXECUTABLE
				? { executablePath: envs.PUPPETEER_EXECUTABLE }
				: {}),
			// Avoid the CDP connection hanging forever if Chrome stalls on a
			// headless server (e.g. missing GPU/shm). 60s is generous for a screenshot.
			protocolTimeout: 60_000,
			args: [
				// Required when running as root / inside containers and on most
				// CI/server distros without a Chrome sandbox configured.
				"--no-sandbox",
				"--disable-setuid-sandbox",
				// /dev/shm is tiny on many servers; force Chrome to use /tmp instead.
				"--disable-dev-shm-usage",
				// No GPU on a headless server — disable to avoid crashes/warnings.
				"--disable-gpu",
				"--disable-software-rasterizer",
				// Stability on minimal Ubuntu installs.
				"--no-zygote",
				"--hide-scrollbars",
				"--font-render-hinting=none",
			],
		});
	}
	return browserPromise;
}

export async function closeBrowser(): Promise<void> {
	if (browserPromise) {
		const b = await browserPromise;
		await b.close();
		browserPromise = null;
	}
}

function paletteStyleBlock(palette?: Palette): string {
	if (!palette) return "";
	const vars = Object.entries(palette.colors)
		.map(([k, v]) => `  --${k}: ${v};`)
		.join("\n");
	return `<style>:root{\n${vars}\n}</style>`;
}

/**
 * Assembles a full HTML document from a page's body fragment, the compiled
 * Tailwind+DaisyUI CSS, and the active palette (if any).
 */
export async function assembleHtml(
	page: Page,
	palette: Palette | undefined,
): Promise<string> {
	const css = await compileCss(page.html);
	const theme = palette?.daisyTheme;
	return `<!doctype html>
<html lang="es"${theme ? ` data-theme="${theme}"` : ""}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(page.name)}</title>
<style>${css}</style>
${paletteStyleBlock(palette)}
</head>
<body>
${page.html}
</body>
</html>`;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export async function screenshot(
	page: Page,
	palette: Palette | undefined,
	options: {
		viewport?: { width: number; height: number };
	},
): Promise<Uint8Array> {
	const html = await assembleHtml(page, palette);
	const browser = await getBrowser();
	const tab = await browser.newPage();
	try {
		if (options.viewport) {
			await tab.setViewport({
				width: options.viewport.width,
				height: options.viewport.height,
				deviceScaleFactor: 1,
			});
		} else {
			await tab.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
		}
		await tab.setContent(html, {
			waitUntil: "networkidle0",
			// Without a timeout a never-idle resource would hang the request
			// indefinitely on the server. Cap it and fall back to whatever loaded.
			timeout: 30_000,
		});
		// Ensure web/icon fonts are fully loaded before capturing, otherwise text
		// can render blank or with fallback metrics on a fresh Ubuntu box.
		await tab
			.evaluate(async () => {
				await document.fonts?.ready;
			})
			.catch(() => undefined);
		const buf = await tab.screenshot({ type: "png", fullPage: true });
		return buf;
	} finally {
		await tab.close();
	}
}
