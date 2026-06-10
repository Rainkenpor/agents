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

---

## Integrar _workspace (archivos y repositorios)

El módulo `_workspace` proporciona dos servicios compartidos que cualquier MCP puede usar:

| Servicio | Qué hace |
|----------|----------|
| `FilesService` | Leer, escribir, borrar y mover archivos con historial automático |
| `RepositoryService` | Clonar, editar, hacer commit/push/pull y cerrar repositorios git identificados por UUID |

Los repositorios se almacenan en carpetas con UUID (`data/repos/<uuid>/`) en lugar de por nombre, por lo que múltiples MCPs pueden trabajar sobre el mismo repositorio con **distintas ramas** sin colisiones.

### Paso 1 — Importar los servicios en tu MCP

```typescript
// tools/mi-dominio.tool.ts
import { FilesService, RepositoryService } from "../../_workspace/index.ts";

// Instanciar una sola vez y compartir entre todas las tools del módulo
const files = new FilesService();
const repos  = new RepositoryService();
```

### Paso 2 — Usar FilesService

```typescript
// Leer un archivo (incluye historial del path)
const { content, history } = files.readFile("/ruta/absoluta/al/archivo.txt", "mi-mcp");

// Escribir (crea directorios padres automáticamente)
files.writeFile("/ruta/output.json", JSON.stringify(data), {
  message: "generado por mi-tool",
  actor: "mi-mcp",
});

// Borrar
files.deleteFile("/ruta/old.txt", { actor: "mi-mcp" });

// Mover / renombrar
files.move("/ruta/a.txt", "/ruta/b.txt");

// Crear directorio
files.createDirectory("/ruta/nueva-carpeta");

// Listar directorio (dirs con "/" al final)
const entries = files.listDirectory("/ruta");

// Consultar historial de un archivo
const history = files.getHistory("/ruta/output.json");
```

### Paso 3 — Usar RepositoryService

```typescript
// Clonar (reutiliza si ya existe el mismo url+branch)
const entry = await repos.clone(
  "https://github.com/org/repo.git",
  "feature/my-branch",
  { label: "mi proyecto" },
);
// entry.id   → UUID (nombre de la carpeta en data/repos/)
// entry.path → ruta absoluta al working tree

// Operaciones sobre archivos del repo
repos.writeFile(entry.id, "src/nuevo.ts", "export const x = 1;");
const content = repos.readFile(entry.id, "src/nuevo.ts");
await repos.deleteFile(entry.id, "src/viejo.ts");
await repos.move(entry.id, "src/a.ts", "src/b.ts");
repos.createDirectory(entry.id, "src/nuevo-modulo");
const ls = repos.listDirectory(entry.id, "src");

// Git
const status = await repos.status(entry.id);
const log    = await repos.log(entry.id, 5);
await repos.commit(entry.id, "feat: cambios nuevos");
await repos.push(entry.id);
await repos.pull(entry.id);

// Cerrar (borra carpeta del disco y registro)
repos.close(entry.id);

// Listar todos los repos registrados
const all = repos.listRepos();
```

### Ejemplo completo — tool que clona y hace commit

```typescript
export const repoTools: ToolDefinition[] = [
  {
    name: "repo_clone",
    description: "Clona un repositorio git en una rama específica",
    inputSchema: {
      url:    z.string().describe("URL remota del repositorio"),
      branch: z.string().describe("Rama a clonar"),
    },
    handler: async ({ url, branch }) => {
      const entry = await repos.clone(url, branch);
      return ok({ id: entry.id, path: entry.path });
    },
  },
  {
    name: "repo_commit_push",
    description: "Hace commit de todos los cambios y push al origen",
    inputSchema: {
      repoId:  z.string().describe("ID del repositorio (devuelto por repo_clone)"),
      message: z.string().describe("Mensaje de commit"),
    },
    handler: async ({ repoId, message }) => {
      await repos.commit(repoId, message);
      await repos.push(repoId);
      return ok({ ok: true });
    },
  },
];
```

> Para documentación completa consulta [`../_workspace/README.md`](../_workspace/README.md).
