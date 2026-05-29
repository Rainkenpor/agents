import puppeteer, { type Browser } from "puppeteer";
import { envs } from "../util/envs";
import type { Page, Palette } from "./schema";
import { compileCss } from "./tailwind";

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
	if (!browserPromise) {
		browserPromise = puppeteer.launch({
			headless: true,
			executablePath: envs.PUPPETEER_EXECUTABLE,
			args: [
				"--no-sandbox",
				"--disable-setuid-sandbox",
				"--disable-dev-shm-usage",
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
		await tab.setContent(html, { waitUntil: "networkidle0" });
		const buf = await tab.screenshot({ type: "png", fullPage: true });
		return buf;
	} finally {
		await tab.close();
	}
}
