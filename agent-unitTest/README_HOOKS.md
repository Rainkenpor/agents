# Hook System — Guía de integración

Los MCPs basados en este template pueden emitir **hooks** (eventos) cuando una herramienta realiza una acción. Cualquier sistema externo puede suscribirse y reaccionar a esos eventos en tiempo real.

---

## Conceptos clave

| Concepto | Descripción |
|---|---|
| **HookDefinition** | Declaración estática de un hook: nombre, descripción y esquema del payload |
| **emit** | Función que los handlers de tools llaman para disparar un evento |
| **SSE stream** | Conexión persistente donde llegan todos los eventos en tiempo real |
| **Webhook** | URL registrada que recibe un `POST` cada vez que ocurre un evento |

---

## Endpoints disponibles

El servidor expone estos endpoints bajo `/hooks` (standalone) o `/<slug>/hooks` (cuando está integrado en `agent-server`):

```
GET  /hooks                          → Catálogo de hooks disponibles
GET  /hooks/stream[?event=<name>]    → Stream SSE de eventos en tiempo real
GET  /hooks/subscriptions            → Listar webhooks registrados
POST /hooks/subscriptions            → Registrar un nuevo webhook
DEL  /hooks/subscriptions/:id        → Eliminar un webhook
```

---

## Opción 1 — Escuchar via SSE (Server-Sent Events)

Ideal para dashboards, terminales o cualquier cliente que mantenga una conexión abierta.

### Conectarse al stream

```bash
# Todos los eventos
curl -N http://localhost:3000/hooks/stream

# Solo un tipo de evento
curl -N "http://localhost:3000/hooks/stream?event=item.created"
```

### Formato de los mensajes

Cada evento llega como una línea `data: <JSON>` seguida de `\n\n`:

```
data: {"name":"connected","subscriberId":"abc-123","filter":"all"}

data: {"name":"item.created","payload":{"id":"uuid","name":"Mi item"},"timestamp":"2026-04-12T10:00:00.000Z"}

data: {"name":"item.fetched","payload":{"id":"uuid"},"timestamp":"2026-04-12T10:01:00.000Z"}
```

### Ejemplo en Node.js / Bun

```typescript
import { EventSource } from "eventsource"; // npm i eventsource

const es = new EventSource("http://localhost:3000/hooks/stream");

es.onmessage = (event) => {
  const { name, payload, timestamp } = JSON.parse(event.data);
  console.log(`[${timestamp}] ${name}`, payload);
};

es.onerror = (err) => {
  console.error("SSE error:", err);
  es.close();
};
```

### Ejemplo en Python

```python
import sseclient, requests

response = requests.get("http://localhost:3000/hooks/stream", stream=True)
client = sseclient.SSEClient(response)

for event in client.events():
    import json
    data = json.loads(event.data)
    print(f"[{data['timestamp']}] {data['name']}", data.get('payload'))
```

---

## Opción 2 — Webhooks (callbacks HTTP)

Ideal para servicios que prefieren recibir `POST` en lugar de mantener una conexión abierta.

### Registrar un webhook

```bash
curl -X POST http://localhost:3000/hooks/subscriptions \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://mi-servicio.com/webhook",
    "events": ["item.created"],
    "secret": "mi-secreto-hmac"
  }'
```

Respuesta:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "url": "https://mi-servicio.com/webhook",
  "events": ["item.created"],
  "createdAt": "2026-04-12T10:00:00.000Z"
}
```

**Campos del body:**

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `url` | `string` | Sí | URL que recibirá los `POST` |
| `events` | `string[]` | No | Lista de hooks a escuchar. Array vacío `[]` = todos los eventos |
| `secret` | `string` | No | Secreto para verificar la firma HMAC-SHA256 |

### Payload que recibirá tu endpoint

```http
POST https://mi-servicio.com/webhook
Content-Type: application/json
X-Hook-Name: item.created
X-Hook-Timestamp: 2026-04-12T10:00:00.000Z
X-Hook-Signature: sha256=abc123...   ← solo si registraste un secret

{
  "name": "item.created",
  "payload": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Mi item",
    "description": "Descripción opcional"
  },
  "timestamp": "2026-04-12T10:00:00.000Z"
}
```

### Verificar la firma HMAC

Si registraste un `secret`, valida cada request antes de procesarlo:

```typescript
import { createHmac } from "node:crypto";

function verifySignature(body: string, secret: string, header: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  // Usar timingSafeEqual para evitar timing attacks
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

// En tu handler Express/Hono/etc:
app.post("/webhook", (req, res) => {
  const sig = req.headers["x-hook-signature"] as string;
  const raw = req.rawBody; // body como string/buffer antes de parse
  if (!verifySignature(raw, "mi-secreto-hmac", sig)) {
    return res.status(401).send("Invalid signature");
  }
  const { name, payload } = req.body;
  // procesar...
  res.sendStatus(200);
});
```

```python
import hmac, hashlib

def verify_signature(body: bytes, secret: str, header: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, header)
```

### Listar webhooks activos

```bash
curl http://localhost:3000/hooks/subscriptions
```

### Eliminar un webhook

```bash
curl -X DELETE http://localhost:3000/hooks/subscriptions/550e8400-e29b-41d4-a716-446655440000
```

---

## Discovery — ver hooks disponibles

El endpoint `GET /hooks` devuelve el catálogo completo: nombre, descripción y esquema del payload de cada hook. Úsalo para saber exactamente qué datos esperar antes de suscribirte.

```bash
curl http://localhost:3000/hooks
```

Respuesta de ejemplo:
```json
[
  {
    "name": "item.created",
    "description": "Fired after example_create_item successfully creates a new item",
    "payload": {
      "id": {
        "type": "string",
        "description": "Generated ID of the created item",
        "optional": false
      },
      "name": {
        "type": "string",
        "description": "Name of the created item",
        "optional": false
      },
      "description": {
        "type": "string",
        "description": "Description if provided",
        "optional": true
      }
    }
  },
  {
    "name": "item.fetched",
    "description": "Fired after example_get_item retrieves an item",
    "payload": {
      "id": {
        "type": "string",
        "description": "ID of the fetched item",
        "optional": false
      }
    }
  }
]
```

### Campos del catálogo

| Campo | Descripción |
|---|---|
| `name` | Nombre del hook en formato `recurso.accion` |
| `description` | Cuándo y por qué se dispara |
| `payload` | Mapa de campos con `type`, `description` y `optional` |

**Tipos posibles en `payload[field].type`:**
`string`, `number`, `boolean`, `array`, `object`, `record`, `enum`, `string (date)`, `null`, `unknown`, `any`

---

## Agregar hooks a un MCP (para desarrolladores)

### 1. Definir los hooks

Crea `hooks/mi-dominio.hook.ts`:

```typescript
import z from "zod";
import type { HookDefinition } from "../types";

export const miDominioHooks: HookDefinition[] = [
  {
    name: "ticket.created",
    description: "Fired when a ticket is created",
    payloadSchema: {
      id: z.string().describe("ID del ticket"),
      title: z.string().describe("Título del ticket"),
    },
  },
  {
    name: "ticket.status_changed",
    description: "Fired when a ticket status changes",
    payloadSchema: {
      id: z.string(),
      from: z.string(),
      to: z.string(),
    },
  },
];
```

### 2. Registrar los hooks en hooks.ts

```typescript
// hooks.ts
import { miDominioHooks } from "./hooks/mi-dominio.hook";

export const registryHook: HookDefinition[] = [
  ...exampleHooks,
  ...miDominioHooks, // ← agregar aquí
];
```

### 3. Emitir el hook desde una tool

```typescript
// tools/mi-dominio.tool.ts
import { emit } from "../hooks";

handler: async ({ title, description }) => {
  // 1. Realizar la acción
  const ticket = await api.createTicket({ title, description });

  // 2. Emitir el hook con el resultado
  await emit("ticket.created", { id: ticket.id, title: ticket.title });

  return ok(ticket);
},
```

### Convención de nombres

Los nombres de hooks siguen el patrón **`<recurso>.<accion-en-pasado>`**:

```
item.created       order.placed        user.deleted
item.updated       order.cancelled     user.role_changed
item.deleted       payment.completed   session.expired
```

---

## Arquitectura interna

```
Tool handler
    │
    ├── await emit("item.created", payload)
    │       │
    │       ├── SSE: escribe data: {...}\n\n en cada conexión abierta
    │       │
    │       └── Webhooks: fetch POST → url (fire-and-forget)
    │
    └── return ok(result)
```

Los subscriptores SSE reciben el evento de forma **sincrónica** (antes de que el tool handler retorne). Los webhooks se entregan de forma **asíncrona** (fire-and-forget, sin bloquear al tool).

---

## Integración en agent-server

Si tu MCP se integra en el servidor centralizado (`agent-server`), el servidor monta automáticamente el `hooksHandler` en `/<slug>/hooks*`:

```typescript
// agent-server/registry.ts — el servidor ya hace esto automáticamente:
// POST  /template/mcp          → module.handler
// GET   /template/hooks        → module.hooksHandler
// GET   /template/hooks/stream → module.hooksHandler
// POST  /template/hooks/subscriptions → module.hooksHandler
```

Asegúrate de que tu `index.ts` exporte ambos campos:

```typescript
export const miMcp: McpModule = {
  slug: "mi-mcp",
  hooks: registryHook.map(h => ({ name: h.name, description: h.description })),
  hooksHandler, // ← handler para /hooks/*
  handler,      // ← handler para /mcp
  // ...
};
```
