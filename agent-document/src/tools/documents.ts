import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { eq, and, sql } from 'drizzle-orm'
import type { DB } from '../db/index.ts'
import { documents, documentSections, templates, templateSections, documentTypes } from '../db/schema.ts'
import { ok } from '../../types.ts'

export function registerDocumentTools(s: McpServer, db: DB): void {
	// ── list_documents ───────────────────────────────────────────────────────────
	s.tool(
		'list_documents',
		'List all documents with optional filters by type_id and/or status',
		{
			type_id: z.string().optional().describe('Filter by document type UUID'),
			status: z.enum(['draft', 'completed', 'generated']).optional().describe('Filter by document status')
		},
		async ({ type_id, status }) => {
			const conditions = []
			if (type_id !== undefined) conditions.push(eq(documents.type_id, type_id))
			if (status !== undefined) conditions.push(eq(documents.status, status))

			const rows =
				conditions.length > 0
					? db
							.select()
							.from(documents)
							.where(and(...conditions))
							.all()
					: db.select().from(documents).all()
			return ok(rows)
		}
	)

	// ── get_document ─────────────────────────────────────────────────────────────
	s.tool(
		'get_document',
		'Get a single document by id or code, including all its sections',
		{
			id: z.string().optional().describe('UUID of the document'),
			code: z.string().optional().describe('Code of the document (e.g. US-000001)')
		},
		async ({ id, code }) => {
			if (!id && !code) return ok({ error: 'Provide either id or code' })

			const document = id
				? db.select().from(documents).where(eq(documents.id, id)).get()
				: db.select().from(documents).where(eq(documents.code, code!)).get()

			if (!document) return ok({ error: 'Document not found' })

			const sections = db.select().from(documentSections).where(eq(documentSections.document_id, document.id)).all()

			return ok({ ...document, sections })
		}
	)

	// ── create_document ──────────────────────────────────────────────────────────
	s.tool(
		'create_document',
		'Create a new document from a template. Provide template_id or template_code. Auto-generates code and copies template sections.',
		{
			template_id: z.string().optional().describe('UUID of the template to use'),
			template_code: z.string().optional().describe('Code of the template to use (e.g. US)'),
			title: z.string().describe('Document title')
		},
		async ({ template_id, template_code, title }) => {
			if (!template_id && !template_code) return ok({ error: 'Provide either template_id or template_code' })

			// Load template
			const template = template_id
				? db.select().from(templates).where(eq(templates.id, template_id)).get()
				: db.select().from(templates).where(eq(templates.code, template_code!)).get()
			if (!template) return ok({ error: 'Template not found' })

			// Load document type
			const docType = db.select().from(documentTypes).where(eq(documentTypes.id, template.type_id)).get()
			if (!docType) return ok({ error: 'Document type not found for template' })

			// Count existing documents for this type to generate sequence
			const countResult = db.select({ count: sql<number>`count(*)` }).from(documents).where(eq(documents.type_id, template.type_id)).get()
			const seq = (countResult?.count ?? 0) + 1
			const code = `${docType.code}-${String(seq).padStart(6, '0')}`

			const now = new Date().toISOString()
			const documentId = crypto.randomUUID()

			db.insert(documents)
				.values({
					id: documentId,
					code,
					title,
					status: 'draft',
					template_id,
					type_id: template.type_id,
					created_at: now,
					updated_at: now
				})
				.run()

			// Copy template sections as document sections
			const tmplSections = db
				.select()
				.from(templateSections)
				.where(eq(templateSections.template_id, template_id))
				.all()
				.sort((a, b) => a.order_index - b.order_index)

			for (const tmplSection of tmplSections) {
				db.insert(documentSections)
					.values({
						id: crypto.randomUUID(),
						document_id: documentId,
						template_section_id: tmplSection.id,
						name: tmplSection.name,
						content: tmplSection.default_content ?? null,
						created_at: now,
						updated_at: now
					})
					.run()
			}

			const document = db.select().from(documents).where(eq(documents.id, documentId)).get()
			const sections = db.select().from(documentSections).where(eq(documentSections.document_id, documentId)).all()

			return ok({ ...document, sections })
		}
	)

	// ── update_document ──────────────────────────────────────────────────────────
	s.tool(
		'update_document',
		"Update a document's title by id",
		{
			id: z.string().describe('UUID of the document to update'),
			title: z.string().optional().describe('New title')
		},
		async ({ id, title }) => {
			const existing = db.select().from(documents).where(eq(documents.id, id)).get()
			if (!existing) return ok({ error: 'Document not found' })

			const now = new Date().toISOString()
			const updates: Record<string, unknown> = { updated_at: now }
			if (title !== undefined) updates.title = title

			db.update(documents).set(updates).where(eq(documents.id, id)).run()

			const row = db.select().from(documents).where(eq(documents.id, id)).get()
			return ok(row)
		}
	)

	// ── update_document_status ───────────────────────────────────────────────────
	s.tool(
		'update_document_status',
		'Update the status of a document',
		{
			id: z.string().describe('UUID of the document'),
			status: z.enum(['draft', 'completed', 'generated']).describe('New status for the document')
		},
		async ({ id, status }) => {
			const existing = db.select().from(documents).where(eq(documents.id, id)).get()
			if (!existing) return ok({ error: 'Document not found' })

			const now = new Date().toISOString()
			db.update(documents).set({ status, updated_at: now }).where(eq(documents.id, id)).run()

			const row = db.select().from(documents).where(eq(documents.id, id)).get()
			return ok(row)
		}
	)

	// ── update_document_section ──────────────────────────────────────────────────
	s.tool(
		'update_document_section',
		'Update the content of a document section by id',
		{
			id: z.string().describe('UUID of the document section'),
			content: z.string().describe('New content for the section')
		},
		async ({ id, content }) => {
			const existing = db.select().from(documentSections).where(eq(documentSections.id, id)).get()
			if (!existing) return ok({ error: 'Document section not found' })

			const now = new Date().toISOString()
			db.update(documentSections).set({ content, updated_at: now }).where(eq(documentSections.id, id)).run()

			const row = db.select().from(documentSections).where(eq(documentSections.id, id)).get()
			return ok(row)
		}
	)

	// ── delete_document ──────────────────────────────────────────────────────────
	s.tool(
		'delete_document',
		'Hard-delete a document and all its sections by id',
		{
			id: z.string().describe('UUID of the document to delete')
		},
		async ({ id }) => {
			const existing = db.select().from(documents).where(eq(documents.id, id)).get()
			if (!existing) return ok({ error: 'Document not found' })

			db.delete(documents).where(eq(documents.id, id)).run()

			return ok({
				success: true,
				message: `Document '${existing.code}' deleted`
			})
		}
	)
}
