/**
 * Maps Pencil fontFamily/fontWeight to web-safe stacks for SVG rendering.
 * resvg-js will fall back to its bundled fonts when the requested one isn't installed.
 */
export function fontStack(family?: string): string {
	const f = (family ?? "Inter").trim();
	const lower = f.toLowerCase();
	if (lower === "inter") return "Inter, 'Segoe UI', Arial, sans-serif";
	if (lower.includes("mono")) return "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace";
	if (lower.includes("serif")) return "Georgia, 'Times New Roman', serif";
	return `'${f}', sans-serif`;
}

export function weightToNumber(w?: string): number {
	if (!w) return 400;
	const n = Number(w);
	if (!Number.isNaN(n)) return n;
	const map: Record<string, number> = {
		thin: 100,
		extralight: 200,
		light: 300,
		normal: 400,
		regular: 400,
		medium: 500,
		semibold: 600,
		bold: 700,
		extrabold: 800,
		black: 900,
	};
	return map[w.toLowerCase()] ?? 400;
}
