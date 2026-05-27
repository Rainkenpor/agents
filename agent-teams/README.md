# agent-teams — MCP de Microsoft Teams

MCP para **crear chats, crear grupos (Teams), asignar usuarios a los grupos y
escribir mensajes** en chats y canales de Microsoft Teams, vía
[Microsoft Graph](https://learn.microsoft.com/graph/) con flujo
`client_credentials` (app-only).

## Credenciales

Se leen del `.env` de la carpeta **root** del monorepo (agent-server las carga
con `dotenv.config({ path: "../.env" })`):

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `TEAMS_TENANT_ID` | ✅ | Directory (tenant) ID de Azure AD |
| `TEAMS_CLIENT_ID` | ✅ | Application (client) ID de la app registrada |
| `TEAMS_CLIENT_SECRET` | ✅ | Client secret de la app registrada |
| `TEAMS_APP_USER_ID` | ❌ | Usuario asociado a la app (UPN o ID). Se incluye automáticamente como miembro al crear chats y como owner al crear Teams |
| `GRAPH_BASE_URL` | ❌ | Base de Graph (default `https://graph.microsoft.com/v1.0`) |

> **Flujo app-only:** Microsoft Graph no acepta crear chats/Teams sin un usuario
> real. Configura `TEAMS_APP_USER_ID` con el usuario/service account de la app;
> se agregará automáticamente (sin duplicar) a `teams_create_chat` y
> `teams_create_team`, además de los miembros/owners que pases.

## Tools

| Tool | Descripción |
|------|-------------|
| `teams_list_users` | Lista usuarios del directorio (para obtener IDs/UPN) |
| `teams_create_chat` | Crea un chat `oneOnOne` o `group` |
| `teams_add_chat_member` | Agrega un usuario a un chat |
| `teams_send_chat_message` | Escribe un mensaje en un chat |
| `teams_list_chat_messages` | Lista mensajes de un chat |
| `teams_create_team` | Crea un grupo/Team (requiere owner) |
| `teams_list_teams` | Lista los grupos/Teams existentes |
| `teams_add_team_member` | Asigna un usuario a un grupo/Team (member/owner) |
| `teams_list_channels` | Lista canales de un Team |
| `teams_send_channel_message` | Escribe un mensaje en un canal |

## Hooks

`chat.created`, `team.created`, `member.added`, `message.sent`.

## Permisos de Microsoft Graph (Azure AD → API permissions, tipo *Application*)

La app debe tener consentidos los permisos correspondientes a las operaciones:

- `User.Read.All` — listar usuarios
- `Chat.Create`, `ChatMember.ReadWrite.All` — crear chats / agregar miembros
- `Group.ReadWrite.All`, `Team.Create`, `TeamMember.ReadWrite.All` — crear/gestionar Teams
- `ChannelMessage.Send` / `Teamwork.Migrate.All` — mensajes en canales
- Envío de mensajes en chats con app-only requiere
  [permisos protegidos / RSC](https://learn.microsoft.com/graph/teams-protected-apis).

> Sin estos permisos las tools devolverán el error de Graph (`403 Forbidden`)
> con el detalle correspondiente.

## Ejecución

```bash
# Standalone (carga el .env root)
bun run server.ts          # → http://localhost:3003/mcp

# Integrado: ya registrado en agent-server/registry.ts como teamsMcp
bun run --filter agent-server start   # → POST /teams/mcp
```
