import z from "zod";
import type { HookDefinition } from "../types";

export const sonarHooks: HookDefinition[] = [
	{
		name: "project.created",
		description:
			"Se dispara después de que sonar_create_project crea un proyecto exitosamente",
		payloadSchema: {
			projectKey: z.string().describe("Clave del proyecto creado"),
			name: z.string().describe("Nombre del proyecto creado"),
			visibility: z
				.enum(["public", "private"])
				.optional()
				.describe("Visibilidad del proyecto si se especificó"),
		},
	},
	{
		name: "project.deleted",
		description:
			"Se dispara después de que sonar_delete_project elimina un proyecto",
		payloadSchema: {
			projectKey: z.string().describe("Clave del proyecto eliminado"),
		},
	},
];
