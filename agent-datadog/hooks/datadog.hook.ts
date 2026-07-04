import type { HookDefinition } from "../types";

// Solo se exponen tools de consulta; no hay eventos de mutación que emitir.
export const datadogHooks: HookDefinition[] = [];
