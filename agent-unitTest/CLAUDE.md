# CLAUDE.md — Agent MCP Template

Este documento guía el desarrollo con este template de MCP.

## Estructura del Proyecto

```
agent-template/
├── index.ts           # Punto de conexión al servidor central (agent-server)
├── server.ts          # Servidor standalone independiente
├── types.ts           # Interfaces compartidas
├── tools.ts           # Registry central de tools
├── hooks.ts           # Registry central de hooks
├── tools/             # Tools por dominio (Registry Pattern)
├── hooks/             # Hooks por dominio
└── util/
    ├── envs.ts        # Variables de entorno
    └── logger.ts      # Winston logger
```

## Conceptos Clave

### index.ts vs server.ts

| Archivo | Propósito | Cuándo usarlo |
|---------|-----------|---------------|
| **index.ts** | Exporta `McpModule` para integración en `agent-server`. El servidor central monta automáticamente endpoints en `/<slug>/mcp` y `/<slug>/hooks/*` | Cuando el MCP será registrado en el servidor centralizado |
| **server.ts** | Servidor HTTP independiente que escucha en un puerto | Para desarrollo local standalone o cuando no se usa agent-server |

### McpModule (index.ts)

Exporta un objeto con la estructura que agent-server espera:

```typescript
export const templateMcp: McpModule = {
  slug: "template",           // Identificador único
  displayName: "MCP Template", // Nombre para UI
  credentials: [...],         // Configuración de credenciales
  tools: [...],              // Tools disponibles
  hooks: [...],              // Hooks disponibles
  handler,                   // POST /<slug>/mcp
  hooksHandler,               // GET/POST /<slug>/hooks*
};
```

### Tools (MCP)

Las tools son funciones que el LLM puede invocar. Cada tool tiene:
- `name`: identificador en snake_case
- `description`: descripción clara para el LLM
- `inputSchema`: esquema Zod con describe() para cada parámetro
- `handler`: función async que recibe los parámetros y devuelve `ok(data)`

### Hooks (Eventos)

Los hooks son eventos que se disparan cuando ocurre algo. Los clientes pueden:
- Escuchar via SSE (`GET /hooks/stream`)
- Registrarse via webhooks (`POST /hooks/subscriptions`)

## Comandos

```bash
# Instalar dependencias
bun install

# Ejecutar servidor standalone
bun run server.ts

# Ejecutar con tsx ( TypeScript directo)
bun run index.ts   # Para probar integración con agent-server
```

## Variables de Entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `BASE_URL` | URL base de la API destino | - |
| `PORT` | Puerto del servidor standalone | 3000 |

## Agregar una nueva Tool

1. Crear `tools/mi-dominio.tool.ts`:
   ```typescript
   export const miDominioTools: ToolDefinition[] = [
     {
       name: "mi_dominio_accion",
       description: "Descripción clara para el LLM",
       inputSchema: {
         param: z.string().describe("Descripción del parámetro"),
       },
       handler: async ({ param }) => {
         return ok({ resultado: param });
       },
     },
   ];
   ```

2. Registrar en `tools.ts`:
   ```typescript
   import { miDominioTools } from "./tools/mi-dominio.tool";
   
   const registry: ToolDefinition[] = [
     ...miDominioTools,
   ];
   ```

## Agregar un nuevo Hook

1. Crear `hooks/mi-dominio.hook.ts`:
   ```typescript
   export const miDominioHooks: HookDefinition[] = [
     {
       name: "recurso.creado",
       description: "Se dispara cuando se crea un recurso",
       payloadSchema: {
         id: z.string().describe("ID del recurso"),
       },
     },
   ];
   ```

2. Registrar en `hooks.ts`:
   ```typescript
   import { miDominioHooks } from "./hooks/mi-dominio.hook";
   
   export const registryHook: HookDefinition[] = [
     ...miDominioHooks,
   ];
   ```

3. Emitir desde una tool:
   ```typescript
   import { emit } from "./hooks.ts";
   
   handler: async ({ ... }) => {
     const resultado = await crearRecurso();
     await emit("recurso.creado", { id: resultado.id });
     return ok(resultado);
   }
   ```

## Convenciones

- **Tools**: nombre en `snake_case` (ej: `mi_dominio_accion`)
- **Hooks**: patrón `<recurso>.<accion-en-pasado>` (ej: `item.created`)
- **Handlers**: siempre devolver `ok(data)` desde `types.ts`
- Documentar parámetros con `z.string().describe("...")`