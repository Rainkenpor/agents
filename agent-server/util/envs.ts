import type { McpModule } from "../types.ts";
import { logger } from "./logger.ts";
import dotenv from "dotenv";

dotenv.config({path: "../.env"});

/**
 * Valida las credentials de todos los MCPs registrados.
 * - required: true  → lanza Error si la variable no está definida (startup abortado)
 * - required: false → loguea warn y continúa
 */
export function validateEnvs(modules: McpModule[]): void {
	const hasErrors = [];

	for (const mcp of modules) {
		if (mcp.credentials.length === 0) continue;

		for (const cred of mcp.credentials) {
			const value = process.env[cred.key];

			if (!value) {
				if (cred.required) {
					logger.error(
						`[envs] FALTA variable requerida: ${cred.key} (${mcp.displayName}) — ${cred.description}`,
					);
					hasErrors.push(cred.key);
				} else {
					logger.warn(
						`[envs] ${cred.key}: no definida (opcional) — ${cred.description}`,
					);
				}
			} else {
				logger.info(`[envs] ${cred.key}: OK`);
			}
		}
	}

	if (hasErrors.length > 0) {
    logger.error(
      `[envs] Startup abortado: faltan variables de entorno requeridas: ${hasErrors.join(", ")}`,
    );
		throw new Error(
			"Startup abortado: faltan variables de entorno requeridas: " + hasErrors.join(", "),
		);
	}
}
