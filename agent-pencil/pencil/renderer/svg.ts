import type { ResolvedNode } from "../layout";
import { renderIcon } from "./icons";
import { fontStack, weightToNumber } from "./fonts";

interface SvgOpts {
	scale?: number;
	background?: string;
}

export function renderSvg(root: ResolvedNode, opts: SvgOpts = {}): string {
	const scale = opts.scale ?? 1;
	const w = Math.max(1, Math.round(root.width));
	const h = Math.max(1, Math.round(root.height));
	const bg = opts.background ?? (typeof root.fill === "string" ? root.fill : "#FFFFFF");

	const parts: string[] = [];
	parts.push(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}">`,
	);
	parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${bg}"/>`);
	// Translate so root's origin is at 0,0
	parts.push(`<g transform="translate(${-root.x}, ${-root.y})">`);
	renderNode(root, parts, /* isRoot */ true);
	parts.push(`</g></svg>`);
	return parts.join("");
}

function renderNode(node: ResolvedNode, out: string[], isRoot = false): void {
	if (node.type === "text") {
		renderText(node, out);
		return;
	}
	if (node.type === "icon_font") {
		renderIconNode(node, out);
		return;
	}

	// frame / default container
	if (!isRoot) {
		const fill =
			typeof node.fill === "string" && node.fill ? node.fill : "transparent";
		const stroke = node.stroke?.fill ?? "none";
		const sw = node.stroke?.thickness ?? 0;
		const rx = Array.isArray(node.cornerRadius)
			? (node.cornerRadius[0] ?? 0)
			: (node.cornerRadius ?? 0);
		if (fill !== "transparent" || stroke !== "none") {
			out.push(
				`<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${rx}" ry="${rx}" fill="${fill}"${stroke !== "none" ? ` stroke="${stroke}" stroke-width="${sw}"` : ""}/>`,
			);
		}
	}

	if (node.clip) {
		const clipId = `clip-${node.id}`;
		out.push(
			`<defs><clipPath id="${clipId}"><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${Array.isArray(node.cornerRadius) ? node.cornerRadius[0] ?? 0 : node.cornerRadius ?? 0}"/></clipPath></defs>`,
		);
		out.push(`<g clip-path="url(#${clipId})">`);
	}

	for (const child of node.children ?? []) {
		renderNode(child, out);
	}

	if (node.clip) out.push(`</g>`);
}

function renderText(node: ResolvedNode, out: string[]): void {
	const fs = node.fontSize ?? 12;
	const color = typeof node.fill === "string" ? node.fill : "#FFFFFF";
	const family = fontStack(node.fontFamily);
	const weight = weightToNumber(node.fontWeight);
	const ls = node.letterSpacing ?? 0;
	const text = escapeXml(node.content ?? "");

	const align = (node as { textAlign?: string }).textAlign ?? "left";
	let anchor = "start";
	let x = node.x;
	if (align === "center") {
		anchor = "middle";
		x = node.x + node.width / 2;
	} else if (align === "right") {
		anchor = "end";
		x = node.x + node.width;
	}

	// Vertical centering: y is the box top; nudge baseline to vertically center the cap height.
	const baseline = node.y + node.height / 2 + fs * 0.34;
	out.push(
		`<text x="${x}" y="${baseline}" fill="${color}" font-family="${family}" font-size="${fs}" font-weight="${weight}" text-anchor="${anchor}"${ls ? ` letter-spacing="${ls}"` : ""}>${text}</text>`,
	);
}

function renderIconNode(node: ResolvedNode, out: string[]): void {
	const color = typeof node.fill === "string" ? node.fill : "#FFFFFF";
	const size = Math.min(node.width, node.height);
	out.push(renderIcon(node.iconFontName ?? "x", node.x, node.y, size, color));
}

function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
