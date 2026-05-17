import { z } from "zod";

// Zod permissivo (passthrough): aceptamos cualquier campo extra.
// Refleja interface.ts del example/.

const dim = z.union([z.number(), z.literal("fill_container"), z.literal("hug_content"), z.string()]);

export const StrokeSchema = z
	.object({
		align: z.string().optional(),
		thickness: z.number().optional(),
		fill: z.string().optional(),
	})
	.passthrough();

export const EffectSchema = z
	.object({
		type: z.string().optional(),
		shadowType: z.string().optional(),
		color: z.string().optional(),
		offset: z.object({ x: z.number(), y: z.number() }).passthrough().optional(),
		blur: z.number().optional(),
	})
	.passthrough();

export const NodeSchema: z.ZodType<PenNode> = z.lazy(() =>
	z
		.object({
			type: z.string(),
			id: z.string(),
			name: z.string().optional(),
			x: z.number().optional(),
			y: z.number().optional(),
			width: dim.optional(),
			height: dim.optional(),
			fill: z.union([z.string(), z.record(z.any())]).optional(),
			content: z.string().optional(),
			layout: z.string().optional(),
			padding: z.array(z.number()).optional(),
			justifyContent: z.string().optional(),
			alignItems: z.string().optional(),
			gap: z.number().optional(),
			clip: z.boolean().optional(),
			cornerRadius: z.union([z.number(), z.array(z.number())]).optional(),
			textGrowth: z.string().optional(),
			letterSpacing: z.number().optional(),
			fontFamily: z.string().optional(),
			fontSize: z.number().optional(),
			fontWeight: z.string().optional(),
			iconFontName: z.string().optional(),
			iconFontFamily: z.string().optional(),
			stroke: StrokeSchema.optional(),
			effect: EffectSchema.optional(),
			ref: z.string().optional(),
			descendants: z.record(z.any()).optional(),
			children: z.array(NodeSchema).optional(),
		})
		.passthrough(),
);

export const DocSchema = z
	.object({
		version: z.string().optional(),
		variables: z.record(z.any()).optional(),
		children: z.array(NodeSchema),
	})
	.passthrough();

export interface PenNode {
	type: string;
	id: string;
	name?: string;
	x?: number;
	y?: number;
	width?: number | string;
	height?: number | string;
	fill?: string | Record<string, unknown>;
	content?: string;
	layout?: string;
	padding?: number[];
	justifyContent?: string;
	alignItems?: string;
	gap?: number;
	clip?: boolean;
	cornerRadius?: number | number[];
	textGrowth?: string;
	letterSpacing?: number;
	fontFamily?: string;
	fontSize?: number;
	fontWeight?: string;
	iconFontName?: string;
	iconFontFamily?: string;
	stroke?: { align?: string; thickness?: number; fill?: string };
	effect?: {
		type?: string;
		shadowType?: string;
		color?: string;
		offset?: { x: number; y: number };
		blur?: number;
	};
	ref?: string;
	descendants?: Record<string, Partial<PenNode>>;
	children?: PenNode[];
	[k: string]: unknown;
}

export interface PenDoc {
	version?: string;
	variables?: Record<string, unknown>;
	children: PenNode[];
	[k: string]: unknown;
}
