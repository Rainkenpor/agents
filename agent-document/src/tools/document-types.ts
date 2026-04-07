import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import type { DB } from '../db/index.ts'
import { documentTypes } from '../db/schema.ts'
import { ok } from '../../types.ts'

export function registerDocumentTypeTools(s: McpServer, db: DB): void {
	// ── list_document_types ──────────────────────────────────────────────────────
	s.tool(
		'list_document_types',
		'List all document types, with optional filter by active status',
		{
			active: z.boolean().optional().describe('Filter by active status. Omit to return all.')
		},
		async ({ active }) => {
			const conditions = []
			if (active !== undefined) {
				conditions.push(eq(documentTypes.active, active))
			}
			const rows =
				conditions.length > 0
					? db
							.select()
							.from(documentTypes)
							.where(and(...conditions))
							.all()
					: db.select().from(documentTypes).all()
			return ok(rows)
		}
	)

	// ── get_document_type ────────────────────────────────────────────────────────
	s.tool(
		'get_document_type',
		'Get a single document type by id or code',
		{
			id: z.string().optional().describe('UUID of the document type'),
			code: z.string().optional().describe('Code of the document type (e.g. US)')
		},
		async ({ id, code }) => {
			if (!id && !code) {
				return ok({ error: 'Provide either id or code' })
			}
			const row = id
				? db.select().from(documentTypes).where(eq(documentTypes.id, id)).get()
				: db.select().from(documentTypes).where(eq(documentTypes.code, code!)).get()
			if (!row) return ok({ error: 'Document type not found' })
			return ok(row)
		}
	)

	// ── create_document_type ─────────────────────────────────────────────────────
	s.tool(
		'create_document_type',
		'Create a new document type',
		{
			code: z.string().describe('Short uppercase code for this type (e.g. US, BUG)'),
			name: z.string().describe('Human-readable name for this document type'),
			description: z.string().optional().describe('Optional description')
		},
		async ({ code, name, description }) => {
			const now = new Date().toISOString()
			const id = crypto.randomUUID()
			const upperCode = code.toUpperCase()

			// Check uniqueness
			const existing = db.select().from(documentTypes).where(eq(documentTypes.code, upperCode)).get()
			if (existing) {
				return ok({
					error: `Document type with code '${upperCode}' already exists`
				})
			}

			db.insert(documentTypes)
				.values({
					id,
					code: upperCode,
					name,
					description: description ?? null,
					active: true,
					created_at: now,
					updated_at: now
				})
				.run()

			const row = db.select().from(documentTypes).where(eq(documentTypes.id, id)).get()
			return ok(row)
		}
	)

	// ── update_document_type ─────────────────────────────────────────────────────
	s.tool(
		'update_document_type',
		'Update an existing document type by id',
		{
			id: z.string().describe('UUID of the document type to update'),
			code: z.string().optional().describe('New code (will be uppercased)'),
			name: z.string().optional().describe('New name'),
			description: z.string().optional().describe('New description'),
			active: z.boolean().optional().describe('Set active status')
		},
		async ({ id, code, name, description, active }) => {
			const existing = db.select().from(documentTypes).where(eq(documentTypes.id, id)).get()
			if (!existing) return ok({ error: 'Document type not found' })

			const now = new Date().toISOString()
			const updates: Record<string, unknown> = { updated_at: now }
			if (code !== undefined) updates.code = code.toUpperCase()
			if (name !== undefined) updates.name = name
			if (description !== undefined) updates.description = description
			if (active !== undefined) updates.active = active

			db.update(documentTypes).set(updates).where(eq(documentTypes.id, id)).run()

			const row = db.select().from(documentTypes).where(eq(documentTypes.id, id)).get()
			return ok(row)
		}
	)

	// ── delete_document_type ─────────────────────────────────────────────────────
	s.tool(
		'delete_document_type',
		'Soft-delete a document type by setting active=false',
		{
			id: z.string().describe('UUID of the document type to delete')
		},
		async ({ id }) => {
			const existing = db.select().from(documentTypes).where(eq(documentTypes.id, id)).get()
			if (!existing) return ok({ error: 'Document type not found' })

			const now = new Date().toISOString()
			db.update(documentTypes).set({ active: false, updated_at: now }).where(eq(documentTypes.id, id)).run()

			return ok({
				success: true,
				message: `Document type '${existing.code}' deactivated`
			})
		}
	)
}
