import { db } from './index.ts'
import { documentTypes, templates, templateSections } from './schema.ts'
import { eq } from 'drizzle-orm'

export async function seed() {
	// Check if already seeded
	const existing = db.select().from(documentTypes).where(eq(documentTypes.code, 'US')).get()

	if (existing) {
		console.log('[seed] Already seeded, skipping.')
		return
	}

	const now = new Date().toISOString()

	// Create document type
	const typeId = crypto.randomUUID()
	db.insert(documentTypes)
		.values({
			id: typeId,
			code: 'US',
			name: 'User Story',
			description: 'A user story document describing a feature from the user perspective',
			active: true,
			created_at: now,
			updated_at: now
		})
		.run()

	// Create template
	const templateId = crypto.randomUUID()
	db.insert(templates)
		.values({
			id: templateId,
			code: 'US',
			name: 'User Story Template',
			description: 'Standard user story template with all common sections',
			type_id: typeId,
			active: true,
			created_at: now,
			updated_at: now
		})
		.run()

	// Create template sections
	const sections = [
		{
			name: 'Overview',
			description: 'High-level summary of the user story',
			required: true,
			order_index: 0,
			default_content: 'As a [user type], I want [goal] so that [reason].'
		},
		{
			name: 'Acceptance Criteria',
			description: 'Conditions that must be met for the story to be considered complete',
			required: true,
			order_index: 1,
			default_content: '- Given [context], when [action], then [outcome].'
		},
		{
			name: 'Business Rules',
			description: 'Business rules and constraints that apply to this story',
			required: false,
			order_index: 2,
			default_content: null
		},
		{
			name: 'Technical Notes',
			description: 'Technical implementation notes and considerations',
			required: false,
			order_index: 3,
			default_content: null
		},
		{
			name: 'UI/UX Mockups',
			description: 'Links or references to UI/UX mockups and designs',
			required: false,
			order_index: 4,
			default_content: null
		},
		{
			name: 'Dependencies',
			description: 'Other stories, tasks, or systems this story depends on',
			required: false,
			order_index: 5,
			default_content: null
		}
	]

	for (const section of sections) {
		db.insert(templateSections)
			.values({
				id: crypto.randomUUID(),
				template_id: templateId,
				name: section.name,
				description: section.description,
				required: section.required,
				order_index: section.order_index,
				default_content: section.default_content,
				created_at: now,
				updated_at: now
			})
			.run()
	}

	console.log('[seed] Seeded US document type and template with 6 sections.')
}

// Run seed if this file is executed directly
if (import.meta.main) {
	await seed()
}
