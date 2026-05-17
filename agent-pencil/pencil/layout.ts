import type { PenDoc, PenNode } from "./schema";

export interface ResolvedNode extends PenNode {
	x: number;
	y: number;
	width: number;
	height: number;
	children?: ResolvedNode[];
}

const CHAR_W_RATIO = 0.55;

function isFill(v: unknown): boolean {
	return typeof v === "string" && v.startsWith("fill_container");
}
function isHug(v: unknown): boolean {
	return v === undefined || (typeof v === "string" && v.startsWith("hug_content"));
}
/**
 * Pencil sometimes serializes sizes as `fill_container(852)` / `hug_content(120)`,
 * where the number in parens is the resolved value at design time. Use it as a hint
 * when available — it's more accurate than re-computing from layout alone (especially
 * for fill children inside layout="none" parents).
 */
function sizeHint(v: unknown): number | null {
	if (typeof v !== "string") return null;
	const m = v.match(/\((\d+(?:\.\d+)?)\)/);
	return m ? Number(m[1]) : null;
}

function getPadding(n: PenNode): [number, number, number, number] {
	const p = n.padding ?? [0];
	if (p.length === 1) return [p[0], p[0], p[0], p[0]];
	if (p.length === 2) return [p[0], p[1], p[0], p[1]];
	if (p.length === 4) return [p[0], p[1], p[2], p[3]];
	return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 0];
}

function measureText(n: PenNode): { w: number; h: number } {
	const fs = n.fontSize ?? 12;
	const text = n.content ?? "";
	const w = Math.ceil(text.length * fs * CHAR_W_RATIO);
	const h = Math.ceil(fs * 1.3);
	return { w, h };
}

function intrinsicSize(n: PenNode): { w: number; h: number } {
	if (n.type === "text") {
		const { w, h } = measureText(n);
		return {
			w: typeof n.width === "number" ? n.width : w,
			h: typeof n.height === "number" ? n.height : h,
		};
	}
	if (n.type === "icon_font") {
		return {
			w: typeof n.width === "number" ? n.width : 22,
			h: typeof n.height === "number" ? n.height : 22,
		};
	}
	return {
		w: typeof n.width === "number" ? n.width : 0,
		h: typeof n.height === "number" ? n.height : 0,
	};
}

export function computeLayout(doc: PenDoc): ResolvedNode[] {
	return (doc.children ?? []).map((root) => {
		const w = typeof root.width === "number" ? root.width : 1520;
		const h = typeof root.height === "number" ? root.height : 780;
		return layoutNode(root, 0, 0, w, h);
	});
}

function layoutNode(
	node: PenNode,
	x: number,
	y: number,
	parentW: number,
	parentH: number,
): ResolvedNode {
	const intrinsic = intrinsicSize(node);
	const wHint = sizeHint(node.width);
	const hHint = sizeHint(node.height);
	let w = isFill(node.width)
		? (wHint ?? parentW)
		: typeof node.width === "number"
			? node.width
			: intrinsic.w;
	let h = isFill(node.height)
		? (hHint ?? parentH)
		: typeof node.height === "number"
			? node.height
			: intrinsic.h;

	const [pt, pr, pb, pl] = getPadding(node);
	const layout =
		node.layout ?? (node.children && node.children.length > 0 ? "horizontal" : "none");
	const gap = node.gap ?? 0;
	const kids = node.children ?? [];
	const children: ResolvedNode[] = [];

	if (layout === "none" || kids.length === 0) {
		for (const c of kids) {
			const cx = (c.x ?? 0);
			const cy = (c.y ?? 0);
			const innerW = Math.max(0, w - pl - pr);
			const innerH = Math.max(0, h - pt - pb);
			children.push(layoutNode(c, cx + pl, cy + pt, innerW, innerH));
		}
		if (isHug(node.width) && kids.length > 0) {
			const maxRight = Math.max(...children.map((c) => c.x + c.width));
			w = maxRight + pr;
		}
		if (isHug(node.height) && kids.length > 0) {
			const maxBottom = Math.max(...children.map((c) => c.y + c.height));
			h = maxBottom + pb;
		}
	} else {
		const axis: "x" | "y" = layout === "vertical" ? "y" : "x";
		const mainSize: "width" | "height" = axis === "x" ? "width" : "height";
		const crossSize: "width" | "height" = axis === "x" ? "height" : "width";

		const fillIdx: number[] = [];
		const pre: (ResolvedNode | null)[] = new Array(kids.length).fill(null);
		let nonFillMain = 0;
		let crossMax = 0;
		let innerW = Math.max(0, w - pl - pr);
		let innerH = Math.max(0, h - pt - pb);

		// Pass 1: non-fill children (in main axis) — measured with full inner box.
		kids.forEach((c, i) => {
			if (isFill(c[mainSize])) {
				fillIdx.push(i);
				return;
			}
			const r = layoutNode(c, 0, 0, innerW, innerH);
			pre[i] = r;
			nonFillMain += r[mainSize];
			crossMax = Math.max(crossMax, r[crossSize]);
		});

		const gapTotal = kids.length > 1 ? gap * (kids.length - 1) : 0;

		// Hug main axis: shrink self to non-fill total.
		if (isHug(node[mainSize])) {
			const newMain = nonFillMain + gapTotal + (axis === "x" ? pl + pr : pt + pb);
			if (axis === "x") w = newMain;
			else h = newMain;
			innerW = Math.max(0, w - pl - pr);
			innerH = Math.max(0, h - pt - pb);
		}

		const innerMain = axis === "x" ? innerW : innerH;
		const innerCross = axis === "x" ? innerH : innerW;
		const leftover = Math.max(0, innerMain - nonFillMain - gapTotal);
		const share = fillIdx.length > 0 ? leftover / fillIdx.length : 0;

		// Pass 2: fill-main children, each receives `share` along main axis and `innerCross` on cross.
		for (const i of fillIdx) {
			const c = kids[i];
			const pW = axis === "x" ? share : innerCross;
			const pH = axis === "x" ? innerCross : share;
			const r = layoutNode(c, 0, 0, pW, pH);
			pre[i] = r;
			crossMax = Math.max(crossMax, r[crossSize]);
		}

		// Hug cross axis.
		if (isHug(node[crossSize])) {
			const newCross = crossMax + (axis === "x" ? pt + pb : pl + pr);
			if (axis === "x") h = newCross;
			else w = newCross;
		}

		// Final main/cross usable lengths.
		const totalMain = axis === "x" ? w - pl - pr : h - pt - pb;
		const totalCross = axis === "x" ? h - pt - pb : w - pl - pr;
		const childResolved = pre as ResolvedNode[];
		const usedMain =
			childResolved.reduce((acc, c) => acc + c[mainSize], 0) + gapTotal;
		const free = totalMain - usedMain;

		const justify = node.justifyContent ?? "flex_start";
		let mainStart = axis === "x" ? pl : pt;
		let extraGap = gap;
		if (justify === "center") mainStart += free / 2;
		else if (justify === "flex_end") mainStart += free;
		else if (justify === "space_between" && childResolved.length > 1) {
			extraGap = gap + free / (childResolved.length - 1);
		} else if (justify === "space_around" && childResolved.length > 0) {
			const pad = free / (childResolved.length * 2);
			mainStart += pad;
			extraGap = gap + pad * 2;
		}

		const align = node.alignItems ?? "flex_start";
		let mainCursor = mainStart;
		for (const r of childResolved) {
			const cMain = r[mainSize];
			const cCross = r[crossSize];
			let crossOffset = axis === "x" ? pt : pl;
			if (align === "center") crossOffset += (totalCross - cCross) / 2;
			else if (align === "flex_end") crossOffset += totalCross - cCross;
			else if (align === "stretch") {
				if (axis === "x") {
					r.height = totalCross;
				} else {
					r.width = totalCross;
				}
			}
			const targetX = x + (axis === "x" ? mainCursor : crossOffset);
			const targetY = y + (axis === "y" ? mainCursor : crossOffset);
			shift(r, targetX - r.x, targetY - r.y);
			children.push(r);
			mainCursor += cMain + extraGap;
		}
	}

	return { ...(node as PenNode), x, y, width: w, height: h, children };
}

function shift(node: ResolvedNode, dx: number, dy: number): void {
	if (dx === 0 && dy === 0) return;
	node.x += dx;
	node.y += dy;
	if (node.children) for (const c of node.children) shift(c, dx, dy);
}
