// Subset of Lucide-style icons used in example/data.pen.
// Stroke-based, 24x24 viewBox. Each entry is the inner SVG markup.
// Approximate shapes (kept short on purpose) — produces visually-recognizable glyphs.

export const ICONS: Record<string, string> = {
	home: `<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-7h-6v7h-5a1 1 0 0 1-1-1z"/>`,
	"message-square": `<rect x="3" y="4" width="18" height="14" rx="2"/><polyline points="7,18 7,21 11,18"/>`,
	user: `<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>`,
	shield: `<path d="M12 3 4 6v6c0 5 4 8 8 9 4-1 8-4 8-9V6z"/>`,
	users: `<circle cx="9" cy="8" r="3.5"/><path d="M2 21c0-3 3-6 7-6s7 3 7 6"/><circle cx="17" cy="8" r="3"/><path d="M16 14c3 1 6 3 6 7"/>`,
	list: `<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>`,
	zap: `<polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/>`,
	settings: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.1.5.5.9 1 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>`,
	"git-branch": `<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>`,
	"user-plus": `<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 4-7 7-7s7 3 7 7"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/>`,
	"log-out": `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/>`,
	plus: `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,
	x: `<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>`,
	check: `<polyline points="20,6 9,17 4,12"/>`,
	"chevron-down": `<polyline points="6,9 12,15 18,9"/>`,
	"chevron-right": `<polyline points="9,6 15,12 9,18"/>`,
	link: `<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>`,
	"file-text": `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>`,
	edit: `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="m18 2 4 4-11 11H7v-4z"/>`,
	search: `<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/>`,
	"more-horizontal": `<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>`,
};

export function renderIcon(
	name: string,
	x: number,
	y: number,
	size: number,
	color: string,
): string {
	const body = ICONS[name] ?? ICONS.x;
	const stroke = Math.max(1.2, size / 14);
	return `<g transform="translate(${x},${y}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="${stroke * 24 / size}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
}
