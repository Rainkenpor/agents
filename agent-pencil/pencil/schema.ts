import { z } from "zod";

export const PageSchema = z.object({
	id: z.string(),
	name: z.string(),
	html: z.string(),
});
export type Page = z.infer<typeof PageSchema>;

export const PaletteSchema = z.object({
	name: z.string(),
	colors: z.record(z.string()),
	daisyTheme: z.string().optional(),
});
export type Palette = z.infer<typeof PaletteSchema>;

export const DocumentSchema = z.object({
	id: z.string(),
	name: z.string(),
	pages: z.array(PageSchema),
	paletteName: z.string().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type PencilDocument = z.infer<typeof DocumentSchema>;

export const TemplateSchema = z.object({
	name: z.string(),
	pages: z.array(PageSchema),
	paletteName: z.string().optional(),
	createdAt: z.string(),
});
export type Template = z.infer<typeof TemplateSchema>;

export const OperationSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("doc.created"), doc: DocumentSchema }),
	z.object({ type: z.literal("doc.renamed"), before: z.string(), after: z.string() }),
	z.object({ type: z.literal("page.added"), page: PageSchema }),
	z.object({
		type: z.literal("page.updated"),
		pageId: z.string(),
		before: z.string(),
		after: z.string(),
	}),
	z.object({ type: z.literal("page.deleted"), page: PageSchema }),
	z.object({ type: z.literal("page.reordered"), order: z.array(z.string()) }),
	z.object({
		type: z.literal("palette.applied"),
		paletteName: z.string().optional(),
		previous: z.string().optional(),
	}),
]);
export type Operation = z.infer<typeof OperationSchema>;

export type StoredOperation = {
	version: number;
	timestamp: string;
	op: Operation;
};
