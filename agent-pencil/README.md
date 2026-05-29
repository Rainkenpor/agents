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

## Renderizado de imágenes (Puppeteer) en Ubuntu Server

La tool `pencil_page_screenshot` renderiza las páginas con **Chrome headless** vía
Puppeteer ([pencil/render.ts](pencil/render.ts)). En desarrollo (Windows/macOS)
funciona sin configuración, pero un **Ubuntu Server pelado** requiere dos cosas:
el binario de Chromium y las librerías del sistema que necesita para arrancar.

### 1. Librerías del sistema

El Chromium de Puppeteer depende de varias librerías compartidas que no vienen en
una instalación mínima de Ubuntu. Instálalas una vez:

```bash
sudo apt-get update && sudo apt-get install -y \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 \
  fonts-liberation fonts-noto-color-emoji fonts-noto-cjk
```

> Los paquetes `fonts-*` son importantes: sin fuentes instaladas el texto y los
> emojis salen en blanco o como cuadros (□). El código ya espera a
> `document.fonts.ready` antes de capturar, pero las fuentes deben existir.

### 2. Descargar el Chromium que usará Puppeteer

El proyecto usa el Chromium propio de Puppeteer (no se requiere instalar Chrome
del sistema). La descarga se hace con:

```bash
bun run browser:install
```

Esto también corre automáticamente como `postinstall` tras `bun install`. El
binario se guarda en `./.puppeteer-cache` (ver [puppeteer.cache.cjs](puppeteer.cache.cjs)),
**dentro del proyecto** y no en `~/.cache/puppeteer`. Esto es deliberado: bajo
**systemd** el `$HOME` del usuario de servicio suele estar vacío o no escribible,
y la caché por defecto de Puppeteer fallaría. Anclarla al proyecto garantiza que
el lugar donde se descarga y el lugar donde se busca en runtime sean el mismo.

### 3. Variables de entorno relevantes

| Variable                      | Descripción                                                                 | Default                  |
| ----------------------------- | --------------------------------------------------------------------------- | ------------------------ |
| `PUPPETEER_CACHE_DIR`         | Ruta de la caché del navegador. Úsala para una ruta compartida (ej. `/var/lib/agent-pencil/.puppeteer-cache`). Si la defines, **respétala tanto en el install como en el servicio**. | `<proyecto>/.puppeteer-cache` |
| `PENCIL_PUPPETEER_EXECUTABLE` | Ruta a un binario de Chrome/Chromium del sistema. Solo si quieres forzar uno propio en vez del de Puppeteer. | _(vacío → usa el de Puppeteer)_ |

### 4. Ejemplo de unidad systemd

```ini
[Unit]
Description=Agent Pencil MCP
After=network.target

[Service]
WorkingDirectory=/opt/agent-pencil
ExecStart=/usr/local/bin/bun run server.ts
Restart=on-failure
# Opcional: caché compartida fuera del proyecto (debe coincidir con el install)
# Environment=PUPPETEER_CACHE_DIR=/var/lib/agent-pencil/.puppeteer-cache
User=agent-pencil
Group=agent-pencil

[Install]
WantedBy=multi-user.target
```

> Los flags de Chrome (`--no-sandbox`, `--disable-dev-shm-usage`, `--disable-gpu`,
> `--no-zygote`, etc.) ya están configurados en [pencil/render.ts](pencil/render.ts)
> para correr de forma estable en un servidor headless.

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
