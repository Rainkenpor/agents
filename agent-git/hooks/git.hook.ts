import z from "zod";
import type { HookDefinition } from "../types";

export const gitHooks: HookDefinition[] = [
	{
		name: "git.repo_cloned",
		description: "Se dispara cuando se clona un repo y se crea su sesión",
		payloadSchema: {
			code: z.string().describe("Código de 4 dígitos de la sesión"),
			url: z.string().describe("URL del remoto clonado"),
			protocol: z.string().describe("Protocolo usado: http o ssh"),
			defaultBranch: z.string().describe("Rama por defecto del repo"),
			expiresAt: z.string().describe("ISO-8601 en que la sesión expira"),
		},
	},
	{
		name: "git.repo_expired",
		description:
			"Se dispara cuando una sesión alcanza su TTL y el repo se elimina",
		payloadSchema: {
			code: z.string().describe("Código de la sesión expirada"),
			url: z.string().describe("URL del remoto"),
		},
	},
	{
		name: "git.repo_closed",
		description: "Se dispara cuando una sesión se cierra manualmente",
		payloadSchema: {
			code: z.string().describe("Código de la sesión cerrada"),
			url: z.string().describe("URL del remoto"),
		},
	},
	{
		name: "git.branch_switched",
		description: "Se dispara al cambiar de rama (checkout)",
		payloadSchema: {
			code: z.string().describe("Código de la sesión"),
			branch: z.string().describe("Rama a la que se cambió"),
			created: z.boolean().describe("Si la rama fue creada en el checkout"),
		},
	},
	{
		name: "git.branch_created",
		description: "Se dispara al crear una nueva rama",
		payloadSchema: {
			code: z.string().describe("Código de la sesión"),
			name: z.string().describe("Nombre de la rama creada"),
			pushed: z.boolean().describe("Si la rama se publicó al remoto"),
		},
	},
	{
		name: "git.file_written",
		description: "Se dispara al crear o sobrescribir un archivo",
		payloadSchema: {
			code: z.string().describe("Código de la sesión"),
			path: z.string().describe("Ruta relativa del archivo escrito"),
			created: z.boolean().describe("true si el archivo no existía antes"),
		},
	},
	{
		name: "git.file_deleted",
		description: "Se dispara al eliminar un archivo",
		payloadSchema: {
			code: z.string().describe("Código de la sesión"),
			path: z.string().describe("Ruta relativa del archivo eliminado"),
		},
	},
	{
		name: "git.committed",
		description: "Se dispara tras un commit exitoso",
		payloadSchema: {
			code: z.string().describe("Código de la sesión"),
			message: z.string().describe("Mensaje del commit"),
			hash: z.string().describe("Hash del commit creado"),
		},
	},
	{
		name: "git.pushed",
		description: "Se dispara tras un push exitoso al remoto",
		payloadSchema: {
			code: z.string().describe("Código de la sesión"),
			branch: z.string().describe("Rama publicada"),
		},
	},
	{
		name: "git.pulled",
		description: "Se dispara tras un pull desde el remoto",
		payloadSchema: {
			code: z.string().describe("Código de la sesión"),
			summary: z.string().describe("Resumen de cambios traídos"),
		},
	},
];
