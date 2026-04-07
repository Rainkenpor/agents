import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const documentTypes = sqliteTable('document_types', {
	id: text('id').primaryKey(),
	code: text('code').notNull().unique(),
	name: text('name').notNull(),
	description: text('description'),
	active: integer('active', { mode: 'boolean' }).notNull().default(true),
	created_at: text('created_at').notNull(),
	updated_at: text('updated_at').notNull()
})

export const templates = sqliteTable('templates', {
	id: text('id').primaryKey(),
	code: text('code').notNull().unique(),
	name: text('name').notNull(),
	description: text('description'),
	type_id: text('type_id')
		.notNull()
		.references(() => documentTypes.id),
	active: integer('active', { mode: 'boolean' }).notNull().default(true),
	created_at: text('created_at').notNull(),
	updated_at: text('updated_at').notNull()
})

export const templateSections = sqliteTable('template_sections', {
	id: text('id').primaryKey(),
	template_id: text('template_id')
		.notNull()
		.references(() => templates.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	description: text('description'),
	required: integer('required', { mode: 'boolean' }).notNull().default(false),
	order_index: integer('order_index').notNull().default(0),
	default_content: text('default_content'),
	created_at: text('created_at').notNull(),
	updated_at: text('updated_at').notNull()
})

export const documents = sqliteTable('documents', {
	id: text('id').primaryKey(),
	code: text('code').notNull().unique(),
	title: text('title').notNull(),
	status: text('status', { enum: ['draft', 'completed', 'generated'] })
		.notNull()
		.default('draft'),
	template_id: text('template_id')
		.notNull()
		.references(() => templates.id),
	type_id: text('type_id')
		.notNull()
		.references(() => documentTypes.id),
	created_at: text('created_at').notNull(),
	updated_at: text('updated_at').notNull()
})

export const documentSections = sqliteTable('document_sections', {
	id: text('id').primaryKey(),
	document_id: text('document_id')
		.notNull()
		.references(() => documents.id, { onDelete: 'cascade' }),
	template_section_id: text('template_section_id').references(() => templateSections.id),
	name: text('name').notNull(),
	content: text('content'),
	created_at: text('created_at').notNull(),
	updated_at: text('updated_at').notNull()
})
