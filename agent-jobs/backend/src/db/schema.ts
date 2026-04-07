import {
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const repos = sqliteTable("repos", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	name: text("name").notNull(),
	url: text("url").notNull().unique(),
	localPath: text("local_path").notNull(),
	createdAt: integer("created_at").notNull(),
	lastCheckedAt: integer("last_checked_at"),
	status: text("status", { enum: ["cloning", "active", "error"] })
		.notNull()
		.default("cloning"),
	errorMessage: text("error_message"),
});

export const branches = sqliteTable(
	"branches",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repos.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		headSha: text("head_sha").notNull(),
		lastCommitMessage: text("last_commit_message"),
		lastCommitDate: integer("last_commit_date"),
		updatedAt: integer("updated_at").notNull(),
	},
	(t) => [uniqueIndex("uq_repo_branch").on(t.repoId, t.name)],
);

export const branchTracking = sqliteTable("branch_tracking", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	repoId: integer("repo_id")
		.notNull()
		.references(() => repos.id, { onDelete: "cascade" }),
	branchName: text("branch_name").notNull(),
	// Ticket Jira extraído del nombre de la rama (ej: feature/NNVCN-27-Webhook → NNVCN-27)
	jira: text("jira"),
	initialCommitSha: text("initial_commit_sha").notNull(),
	latestCommitSha: text("latest_commit_sha").notNull(),
	status: text("status", { enum: ["pendiente", "completado"] })
		.notNull()
		.default("pendiente"),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
});

export type Repo = typeof repos.$inferSelect;
export type NewRepo = typeof repos.$inferInsert;
export type Branch = typeof branches.$inferSelect;
export type NewBranch = typeof branches.$inferInsert;
export type BranchTracking = typeof branchTracking.$inferSelect;
export type NewBranchTracking = typeof branchTracking.$inferInsert;
