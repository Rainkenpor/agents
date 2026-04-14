# MCP Server Template

Servidor MCP ([Model Context Protocol](https://modelcontextprotocol.io)) sobre **Streamable HTTP**, listo para extender con tus propias tools.

**Stack:** [Bun](https://bun.sh) · TypeScript · `@modelcontextprotocol/sdk` · Zod · Winston

---

## Arquitectura

```
index.ts           →  Punto de conexión al servidor central (agent-server)
server.ts          →  Servidor standalone independiente
tools.ts           →  Registry central (Registry Pattern)
tools/             →  Un archivo por dominio, cada uno exporta ToolDefinition[]
types.ts           →  Interfaces compartidas: AppContext, AppHelpers, ToolDefinition, ok()
util/
  envs.ts          →  Variables de entorno (SERVER_BASE_URL, SERVER_PORT)
  logger.ts        →  Logger Winston (formato: YYYY-MM-DD HH:mm:ss [LEVEL]: mensaje)
```

### index.ts vs server.ts

| Archivo | Propósito | Cuándo usarlo |
| -------- | --------- | ------------- |
| **index.ts** | Exporta `McpModule` para integración en `agent-server`. El servidor central monta automáticamente `/<slug>/mcp` y `/<slug>/hooks/*` | Cuando tu MCP será registrado en el servidor centralizado |
| **server.ts** | Servidor HTTP independiente que escucha en un puerto | Cuando necesitas un servidor standalone o ejecutar localmente sin el agent-server |

### Flujo de una request

```
Cliente  →  POST /mcp
             ↓
          server.ts  →  crea McpServer por request (contexto aislado)
             ↓
          initializeTools()  →  itera registry, llama s.registerTool()
             ↓
          wrapHandler()  →  loguea entrada (→) y salida (←, máx 200 chars)
             ↓
          handler de la tool  →  ejecuta la lógica y devuelve ok(data)
```

---

## Primeros pasos

### 1. Instalar dependencias

```bash
bun install
```

### 2. Configurar variables de entorno

| Variable          | Descripción                       | Default                 |
| ----------------- | --------------------------------- | ----------------------- |
| `SERVER_BASE_URL` | URL base de la API destino        | `http://localhost:3000` |
| `SERVER_PORT`     | Puerto en que escucha el servidor | `3000`                  |

### 3. Eliminar el ejemplo

Antes de agregar tus propias tools, elimina el archivo de ejemplo:

```bash
# Eliminar la tool de ejemplo
rm tools/example.tool.ts
```

Luego en [tools.ts](tools.ts) elimina la línea de import y el spread:

```diff
- import { exampleTools } from "./tools/example.tool";

  const registry: ToolDefinition[] = [
-   ...exampleTools,
  ];
```

### 4. Ejecutar el servidor

Tienes dos opciones:

**Opción A — Servidor standalone (server.ts):**
```bash
bun run server.ts
```

**Opción B — Integración con agent-server (index.ts):**
Registra tu módulo en `agent-server/registry.ts`:
```typescript
import { templateMcp } from "./modules/template/index.ts";

export const registry: McpModule[] = [
  templateMcp,
  // ...otros módulos
];
```

El agent-server montará automáticamente:
- `POST /<slug>/mcp` → handler de index.ts
- `GET /<slug>/hooks*` → hooksHandler de index.ts

Salida esperada al arrancar:

```
✓ MCP server → http://localhost:3000/mcp
  • my_tool_name             — Descripción de la tool
```

---

## Cómo agregar tools

### Paso 1 — Crear el archivo de dominio

Crea `tools/mi-dominio.tool.ts` y exporta un array `ToolDefinition[]`:

```typescript
import z from "zod";
import { ok } from "../types";
import type { ToolDefinition } from "../types";

export const miDominioTools: ToolDefinition[] = [
  {
    name: "mi_dominio_accion",
    description: "Descripción clara para el LLM de qué hace esta tool",
    inputSchema: {
      parametro: z.string().describe("Descripción del parámetro"),
      opcional: z.number().optional().describe("Parámetro opcional"),
    },
    handler: async ({ parametro, opcional }) => {
      const resultado = await hacerAlgo(parametro, opcional);
      return ok(resultado);
    },
  },
];
```

### Paso 2 — Registrar en el Registry

En [tools.ts](tools.ts), importa el array y agrégalo al `registry`:

```typescript
import { miDominioTools } from "./tools/mi-dominio.tool";

const registry: ToolDefinition[] = [
  ...miDominioTools,
  // ...otrasTools,
];
```

Listo. Al reiniciar el servidor, la nueva tool aparece en el log de startup y queda disponible para el LLM.

---

## Logging automático

Cada invocación de tool es interceptada por `wrapHandler` y produce dos líneas de log:

```
2026-03-25 16:53:41 [INFO]: [tool] → mi_dominio_accion({"parametro":"valor"})
2026-03-25 16:53:41 [INFO]: [tool] ← {"content":[{"type":"text","text":"..."}]}
```

La respuesta se trunca a **200 caracteres** seguido de `…` si es más larga.

---

## Endpoint

| Método | Ruta   | Descripción                        |
| ------ | ------ | ---------------------------------- |
| `POST` | `/mcp` | Punto de entrada JSON-RPC para MCP |

Cualquier otra ruta devuelve `404 { "error": "Not Found. Use /mcp" }`.

---

## Convenciones de código

- Nombre de tools en `snake_case`.
- Un archivo `*.tool.ts` por dominio en `tools/`.
- Todos los handlers devuelven `ok(data)` de [types.ts](types.ts).
- Documentar cada parámetro con `z.string().describe("...")`.
