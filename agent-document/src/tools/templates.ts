import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { eq, and, sql } from 'drizzle-orm'
import type { DB } from '../db/index.ts'
import { templates, templateSections, documentTypes } from '../db/schema.ts'
import { ok } from '../../types.ts'

export function registerTemplateTools(s: McpServer, db: DB): void {
	// ── list_templates ───────────────────────────────────────────────────────────
	s.tool(
		'list_templates',
		'List all templates with optional filters by type_id and/or active status',
		{
			type_id: z.string().optional().describe('Filter by document type UUID'),
			active: z.boolean().optional().describe('Filter by active status')
		},
		async ({ type_id, active }) => {
			const conditions = []
			if (type_id !== undefined) conditions.push(eq(templates.type_id, type_id))
			if (active !== undefined) conditions.push(eq(templates.active, active))

			const rows =
				conditions.length > 0
					? db
							.select()
							.from(templates)
							.where(and(...conditions))
							.all()
					: db.select().from(templates).all()
			return ok(rows)
		}
	)

	// ── get_template ─────────────────────────────────────────────────────────────
	s.tool(
		'get_template',
		'Get a single template by id or code, including all its sections',
		{
			id: z.string().optional().describe('UUID of the template'),
			code: z.string().optional().describe('Code of the template (e.g. US-000001)')
		},
		async ({ id, code }) => {
			if (!id && !code) return ok({ error: 'Provide either id or code' })

			const template = id
				? db.select().from(templates).where(eq(templates.id, id)).get()
				: db.select().from(templates).where(eq(templates.code, code!)).get()

			if (!template) return ok({ error: 'Template not found' })

			const sections = db
				.select()
				.from(templateSections)
				.where(eq(templateSections.template_id, template.id))
				.all()
				.sort((a, b) => a.order_index - b.order_index)

			return ok({ ...template, sections })
		}
	)

	// ── create_template ──────────────────────────────────────────────────────────
	s.tool(
		'create_template',
		'Create a new template for a document type. Code is provided manually (e.g. US-STANDARD).',
		{
			type_id: z.string().describe('UUID of the document type'),
			code: z.string().describe('Unique code for this template (e.g. US-STANDARD, US-MINIMAL)'),
			name: z.string().describe('Template name'),
			description: z.string().optional().describe('Optional description'),
			sections: z
				.array(
					z.object({
						name: z.string().describe('Section name'),
						description: z.string().optional().describe('Section description'),
						required: z.boolean().optional().describe('Whether section is required'),
						order_index: z.number().optional().describe('Display order (0-based)'),
						default_content: z.string().optional().describe('Default content for this section')
					})
				)
				.optional()
				.describe('Optional array of sections to create with the template')
		},
		async ({ type_id, code, name, description, sections }) => {
			// Verify type exists
			const docType = db.select().from(documentTypes).where(eq(documentTypes.id, type_id)).get()
			if (!docType) return ok({ error: 'Document type not found' })

			// Check code uniqueness
			const existingCode = db.select().from(templates).where(eq(templates.code, code)).get()
			if (existingCode) return ok({ error: `Template with code '${code}' already exists` })

			const now = new Date().toISOString()
			const templateId = crypto.randomUUID()

			db.insert(templates)
				.values({
					id: templateId,
					code,
					name,
					description: description ?? null,
					type_id,
					active: true,
					created_at: now,
					updated_at: now
				})
				.run()

			// Insert sections if provided
			if (sections && sections.length > 0) {
				for (let i = 0; i < sections.length; i++) {
					const sec = sections[i]
					db.insert(templateSections)
						.values({
							id: crypto.randomUUID(),
							template_id: templateId,
							name: sec.name,
							description: sec.description ?? null,
							required: sec.required ?? false,
							order_index: sec.order_index ?? i,
							default_content: sec.default_content ?? null,
							created_at: now,
							updated_at: now
						})
						.run()
				}
			}

			const template = db.select().from(templates).where(eq(templates.id, templateId)).get()
			const createdSections = db
				.select()
				.from(templateSections)
				.where(eq(templateSections.template_id, templateId))
				.all()
				.sort((a, b) => a.order_index - b.order_index)

			return ok({ ...template, sections: createdSections })
		}
	)

	// ── update_template ──────────────────────────────────────────────────────────
	s.tool(
		'update_template',
		'Update an existing template by id',
		{
			id: z.string().describe('UUID of the template to update'),
			name: z.string().optional().describe('New name'),
			description: z.string().optional().describe('New description'),
			active: z.boolean().optional().describe('Set active status')
		},
		async ({ id, name, description, active }) => {
			const existing = db.select().from(templates).where(eq(templates.id, id)).get()
			if (!existing) return ok({ error: 'Template not found' })

			const now = new Date().toISOString()
			const updates: Record<string, unknown> = { updated_at: now }
			if (name !== undefined) updates.name = name
			if (description !== undefined) updates.description = description
			if (active !== undefined) updates.active = active

			db.update(templates).set(updates).where(eq(templates.id, id)).run()

			const row = db.select().from(templates).where(eq(templates.id, id)).get()
			return ok(row)
		}
	)

	// ── delete_template ──────────────────────────────────────────────────────────
	s.tool(
		'delete_template',
		'Soft-delete a template by setting active=false',
		{
			id: z.string().describe('UUID of the template to delete')
		},
		async ({ id }) => {
			const existing = db.select().from(templates).where(eq(templates.id, id)).get()
			if (!existing) return ok({ error: 'Template not found' })

			const now = new Date().toISOString()
			db.update(templates).set({ active: false, updated_at: now }).where(eq(templates.id, id)).run()

			return ok({
				success: true,
				message: `Template '${existing.code}' deactivated`
			})
		}
	)

	// ── add_template_section ─────────────────────────────────────────────────────
	s.tool(
		'add_template_section',
		'Add a new section to an existing template',
		{
			template_id: z.string().describe('UUID of the template'),
			name: z.string().describe('Section name'),
			description: z.string().optional().describe('Section description'),
			required: z.boolean().optional().describe('Whether this section is required'),
			order_index: z.number().optional().describe('Display order index (0-based)'),
			default_content: z.string().optional().describe('Default content for the section')
		},
		async ({ template_id, name, description, required, order_index, default_content }) => {
			const template = db.select().from(templates).where(eq(templates.id, template_id)).get()
			if (!template) return ok({ error: 'Template not found' })

			const now = new Date().toISOString()
			const id = crypto.randomUUID()

			// If order_index not provided, append at end
			let idx = order_index
			if (idx === undefined) {
				const countResult = db
					.select({ count: sql<number>`count(*)` })
					.from(templateSections)
					.where(eq(templateSections.template_id, template_id))
					.get()
				idx = countResult?.count ?? 0
			}

			db.insert(templateSections)
				.values({
					id,
					template_id,
					name,
					description: description ?? null,
					required: required ?? false,
					order_index: idx,
					default_content: default_content ?? null,
					created_at: now,
					updated_at: now
				})
				.run()

			const row = db.select().from(templateSections).where(eq(templateSections.id, id)).get()
			return ok(row)
		}
	)

	// ── update_template_section ──────────────────────────────────────────────────
	s.tool(
		'update_template_section',
		'Update an existing template section by id',
		{
			id: z.string().describe('UUID of the template section'),
			name: z.string().optional().describe('New name'),
			description: z.string().optional().describe('New description'),
			required: z.boolean().optional().describe('Whether section is required'),
			order_index: z.number().optional().describe('New display order index'),
			default_content: z.string().optional().describe('New default content')
		},
		async ({ id, name, description, required, order_index, default_content }) => {
			const existing = db.select().from(templateSections).where(eq(templateSections.id, id)).get()
			if (!existing) return ok({ error: 'Template section not found' })

			const now = new Date().toISOString()
			const updates: Record<string, unknown> = { updated_at: now }
			if (name !== undefined) updates.name = name
			if (description !== undefined) updates.description = description
			if (required !== undefined) updates.required = required
			if (order_index !== undefined) updates.order_index = order_index
			if (default_content !== undefined) updates.default_content = default_content

			db.update(templateSections).set(updates).where(eq(templateSections.id, id)).run()

			const row = db.select().from(templateSections).where(eq(templateSections.id, id)).get()
			return ok(row)
		}
	)

	// ── delete_template_section ──────────────────────────────────────────────────
	s.tool(
		'delete_template_section',
		'Hard-delete a template section by id',
		{
			id: z.string().describe('UUID of the template section to delete')
		},
		async ({ id }) => {
			const existing = db.select().from(templateSections).where(eq(templateSections.id, id)).get()
			if (!existing) return ok({ error: 'Template section not found' })

			db.delete(templateSections).where(eq(templateSections.id, id)).run()

			return ok({
				success: true,
				message: `Template section '${existing.name}' deleted`
			})
		}
	)
}
