// ══════════════════════════════════════════════════════════════════════════
// Microsoft Teams tools
//
// - Envío de mensajes (chats/canales) → Azure Bot Framework vía
//   botframework-connector (sendToConversation a un conversationId existente).
//   Ver util/bot.ts.
// - Directorio (listar usuarios) y listado de chats → Microsoft Graph
//   (app-only / client_credentials), que no tiene equivalente en Bot Framework.
// ══════════════════════════════════════════════════════════════════════════
import z from "zod";
import { ok } from "../types";
import type { ToolDefinition } from "../types";
import { graph } from "../util/graph";
import { sendMessage, sendToUser } from "../util/bot";
import { envs } from "../util/envs";
import { emit } from "../hooks";

export const teamsTools: ToolDefinition[] = [
	// ─── Usuarios (descubrimiento) ──────────────────────────────────────────────
	{
		name: "teams_list_users",
		description:
			"Lista usuarios del directorio (Azure AD). Útil para obtener los IDs/UPN de los usuarios.",
		inputSchema: {
			search: z
				.string()
				.optional()
				.describe(
					"Texto a buscar en displayName o mail (ej: 'Walter' o 'wronquillo@distelsa.com.gt')",
				),
			top: z
				.number()
				.optional()
				.describe("Máximo de resultados a devolver (default 25)"),
		},
		handler: async ({ search, top }: { search?: string; top?: number }) => {
			const params: Record<string, unknown> = {
				$top: top ?? 25,
				$select: "id,displayName,userPrincipalName,mail",
			};
			if (search) {
				params.$filter = `startswith(displayName,'${search}') or startswith(mail,'${search}') or startswith(userPrincipalName,'${search}')`;
			}
			const data = await graph.get("users", params);
			return ok(data);
		},
	},

	// ─── Chats ──────────────────────────────────────────────────────────────────
	{
		name: "teams_list_chats",
		description:
			"Lista los chats en los que participa un usuario (por defecto el usuario de la app) junto con los miembros de cada chat. Útil para descubrir los conversationId que se usan con teams_send_chat_message.",
		inputSchema: {
			userId: z
				.string()
				.optional()
				.describe(
					"ID o userPrincipalName del usuario cuyos chats se quieren listar. Si se omite, se usa el usuario de la app.",
				),
			chatType: z
				.enum(["oneOnOne", "group", "meeting"])
				.optional()
				.describe("Filtra por tipo de chat (oneOnOne, group o meeting)"),
			top: z
				.number()
				.optional()
				.describe("Máximo de chats a devolver (default 25)"),
		},
		handler: async ({
			userId,
			chatType,
			top,
		}: {
			userId?: string;
			chatType?: "oneOnOne" | "group" | "meeting";
			top?: number;
		}) => {
			const targetUser = userId;
			if (!targetUser) {
				throw new Error("No se indicó userId.");
			}
			const params: Record<string, unknown> = {
				$expand: "members",
				$top: top ?? 25,
			};
			if (chatType) params.$filter = `chatType eq '${chatType}'`;

			const data = (await graph.get(`users/${targetUser}/chats`, params)) as {
				value?: Array<{
					id?: string;
					topic?: string | null;
					chatType?: string;
					members?: Array<{
						displayName?: string;
						userId?: string;
						email?: string;
						roles?: string[];
					}>;
				}>;
			};

			// Normaliza la salida para enfatizar chat + miembros.
			const chats = (data.value ?? []).map((chat) => ({
				id: chat.id,
				topic: chat.topic ?? null,
				chatType: chat.chatType,
				members: (chat.members ?? []).map((m) => ({
					displayName: m.displayName,
					userId: m.userId,
					email: m.email,
					roles: m.roles ?? [],
				})),
			}));

			return ok({ user: targetUser, count: chats.length, chats });
		},
	},
	{
		name: "teams_send_chat_message",
		description:
			"Envía un mensaje a un chat de Teams vía Azure Bot Framework. Soporta texto plano o HTML. Hay dos modos: (1) chat 1:1 → pasa 'userId' (AAD object id del usuario) y se crea/reutiliza la conversación personal automáticamente (la app de Teams debe estar instalada para ese usuario); (2) chat grupal o 1:1 ya existente → pasa 'conversationId' (id de teams_list_chats, ej: '19:...@thread.v2') y el bot debe estar instalado en ese chat. Indica uno de los dos.",
		inputSchema: {
			userId: z
				.string()
				.optional()
				.describe(
					"AAD object id del usuario destino para un chat 1:1. Crea/reutiliza la conversación personal con createConversation. Tiene prioridad sobre conversationId.",
				),
			conversationId: z
				.string()
				.optional()
				.describe(
					"conversationId de un chat existente (id devuelto por teams_list_chats, ej: '19:...@thread.v2'). Se usa si no se indica userId.",
				),
			content: z.string().describe("Contenido del mensaje"),
			contentType: z
				.enum(["text", "html"])
				.optional()
				.describe("Formato del contenido (default 'text')"),
		},
		handler: async ({
			userId,
			conversationId,
			content,
			contentType,
		}: {
			userId?: string;
			conversationId?: string;
			content: string;
			contentType?: "text" | "html";
		}) => {
			if (!userId && !conversationId) {
				throw new Error(
					"Debes indicar 'userId' (chat 1:1) o 'conversationId' (chat existente).",
				);
			}
			const data = userId
				? await sendToUser(userId, content, contentType ?? "text")
				: await sendMessage(
						conversationId as string,
						content,
						contentType ?? "text",
					);
			await emit("message.sent", {
				scope: "chat",
				containerId: data.conversationId ?? conversationId ?? "",
				messageId: data.id ?? "",
			});
			return ok(data);
		},
	},

	// ─── Instalaciones del bot (descubrimiento) ──────────────────────────────────
	{
		name: "teams_list_bot_installations",
		description:
			"Descubre DÓNDE está instalado el bot/app de Teams: chats (1:1, grupo, reunión) y, si los permisos lo permiten, teams y sus canales. Una sola tool. Identifica la app automáticamente por el Microsoft App ID del bot (env BOT_APP_ID); se puede sobreescribir. Útil para saber a qué conversationId se puede enviar mensajes. Nota: chats requiere Chat.ReadBasic.All; teams requiere TeamsAppInstallation.ReadForTeam.All (+ enumeración de grupos). Lo que no esté permitido se reporta como 'available:false' con la razón, sin fallar.",
		inputSchema: {
			scope: z
				.enum(["all", "chats", "teams"])
				.optional()
				.describe(
					"Qué buscar: 'chats', 'teams' (incluye canales) o 'all' (default).",
				),
			teamsAppId: z
				.string()
				.optional()
				.describe(
					"ID de catálogo del teamsApp. Si se indica, se omite la resolución por catálogo.",
				),
			top: z
				.number()
				.optional()
				.describe("Máximo de resultados por tipo (default 50)."),
		},
		handler: async ({
			scope,
			teamsAppId,
			top,
		}: {
			scope?: "all" | "chats" | "teams";
			teamsAppId?: string;
			botAppId?: string;
			top?: number;
		}) => {
			const wantedScope = scope ?? "all";
			const targetBotAppId = envs.BOT_APP_ID;
			const pageSize = top ?? 50;

			// ─── A. Resolver el id de catálogo (teamsApp) ──────────────────────────
			let catalogAppId = teamsAppId;
			let displayName: string | undefined;

			if (!catalogAppId) {
				if (!targetBotAppId) {
					return ok({
						bot: { botAppId: targetBotAppId, teamsAppId: null },
						error:
							"No se pudo determinar el bot: indica 'botAppId' o configura BOT_APP_ID/TEAMS_CLIENT_ID.",
					});
				}

				type TeamsApp = {
					id?: string;
					displayName?: string;
					externalId?: string;
					appDefinitions?: Array<{ bot?: { id?: string } | null }>;
				};

				// Intento 1: filtrar por externalId (== id del manifiesto).
				let app: TeamsApp | undefined;
				try {
					const byExternal = (await graph.get("appCatalogs/teamsApps", {
						$filter: `externalId eq '${targetBotAppId}'`,
						$expand: "appDefinitions",
					})) as { value?: TeamsApp[] };
					app = byExternal.value?.[0];
				} catch {
					// ignoramos; probamos el fallback por bot.id
				}

				// Fallback: el externalId puede no coincidir con el MS App ID del bot.
				// Listamos apps con su bot y comparamos appDefinitions[].bot.id.
				if (!app) {
					try {
						// Nota: appCatalogs/teamsApps NO admite $top; paginamos con @odata.nextLink.
						let nextLink: string | undefined;
						let page = (await graph.get("appCatalogs/teamsApps", {
							$expand: "appDefinitions($expand=bot)",
						})) as { value?: TeamsApp[]; "@odata.nextLink"?: string };

						while (!app) {
							app = (page.value ?? []).find((a) =>
								(a.appDefinitions ?? []).some(
									(d) => d.bot?.id === targetBotAppId,
								),
							);
							nextLink = page["@odata.nextLink"];
							if (app || !nextLink) break;
							page = (await graph.get(nextLink)) as {
								value?: TeamsApp[];
								"@odata.nextLink"?: string;
							};
						}
					} catch (err) {
						return ok({
							bot: { botAppId: targetBotAppId, teamsAppId: null },
							error: `No se pudo consultar el catálogo de apps (¿falta AppCatalog.Read.All?): ${String(err)}`,
						});
					}
				}

				if (!app?.id) {
					return ok({
						bot: { botAppId: targetBotAppId, teamsAppId: null },
						error: `No se encontró ninguna app en el catálogo asociada al bot ${targetBotAppId}.`,
					});
				}
				catalogAppId = app.id;
				displayName = app.displayName;
			}

			const bot = {
				teamsAppId: catalogAppId,
				displayName: displayName ?? null,
				botAppId: targetBotAppId,
			};

			const result: Record<string, unknown> = { bot };

			// ─── B. Chats (org-wide) ───────────────────────────────────────────────
			if (wantedScope === "all" || wantedScope === "chats") {
				try {
					type Chat = {
						id?: string;
						topic?: string | null;
						chatType?: string;
						members?: Array<{
							displayName?: string;
							userId?: string;
							email?: string;
						}>;
					};
					const items: Array<{
						id?: string;
						topic: string | null;
						chatType?: string;
						members: Array<{
							displayName?: string;
							email?: string;
							userId?: string;
						}>;
					}> = [];

					let next: string | undefined;
					let page = (await graph.get("chats", {
						$filter: `installedApps/any(a:a/teamsApp/id eq '${catalogAppId}')`,
						$expand: "members",
						$top: pageSize,
					})) as { value?: Chat[]; "@odata.nextLink"?: string };

					while (true) {
						for (const c of page.value ?? []) {
							items.push({
								id: c.id,
								topic: c.topic ?? null,
								chatType: c.chatType,
								members: (c.members ?? []).map((m) => ({
									displayName: m.displayName,
									email: m.email,
									userId: m.userId,
								})),
							});
						}
						next = page["@odata.nextLink"];
						if (!next || items.length >= pageSize) break;
						page = (await graph.get(next)) as {
							value?: Chat[];
							"@odata.nextLink"?: string;
						};
					}

					result.chats = {
						available: true,
						count: items.length,
						items: items.slice(0, pageSize),
					};
				} catch (err) {
					result.chats = {
						available: false,
						reason:
							"La enumeración de chats a nivel de organización no está soportada en contexto application-only (client_credentials). Para descubrir chats con el bot instalado se requiere autenticación delegada (on-behalf-of un usuario), o recorrer los chats usuario por usuario. Usa scope 'teams' para equipos/canales.",
						detail: String(err),
					};
				}
			}

			// ─── C. Teams y canales (rama degradada) ───────────────────────────────
			if (wantedScope === "all" || wantedScope === "teams") {
				try {
					type Group = { id?: string; displayName?: string };
					const groups = (await graph.get("groups", {
						$filter: "resourceProvisioningOptions/Any(x:x eq 'Team')",
						$select: "id,displayName",
						$top: pageSize,
					})) as { value?: Group[] };

					const items: Array<{
						teamId?: string;
						displayName?: string;
						channels?: Array<{ id?: string; displayName?: string }>;
					}> = [];

					let skipped = 0;
					for (const g of groups.value ?? []) {
						if (!g.id) continue;
						// Cada grupo se aísla: un grupo que cumple el filtro pero no tiene
						// Team aprovisionado responde 404 ("No team found with Group Id"),
						// y a veces hay 504 transitorios. Antes el primer 404 abortaba la
						// rama completa; ahora se omite ese grupo y se continúa.
						let installed: { value?: unknown[] };
						try {
							installed = (await graph.get(`teams/${g.id}/installedApps`, {
								$filter: `teamsApp/id eq '${catalogAppId}'`,
								$expand: "teamsApp",
							})) as { value?: unknown[] };
						} catch {
							skipped++;
							continue;
						}

						if ((installed.value ?? []).length > 0) {
							let channels:
								| Array<{ id?: string; displayName?: string }>
								| undefined;
							try {
								const ch = (await graph.get(`teams/${g.id}/channels`, {
									$select: "id,displayName",
								})) as {
									value?: Array<{ id?: string; displayName?: string }>;
								};
								channels = ch.value;
							} catch {
								// canales opcionales; ignoramos si falla
							}
							items.push({
								teamId: g.id,
								displayName: g.displayName,
								channels,
							});
						}
					}

					result.teams = {
						available: true,
						count: items.length,
						skipped,
						items,
					};
				} catch (err) {
					result.teams = {
						available: false,
						reason:
							"No se pudieron listar los grupos/equipos de la organización. Requiere permiso de aplicación Group.Read.All (o Group.ReadWrite.All) para enumerar grupos.",
						detail: String(err),
					};
				}
			}

			return ok(result);
		},
	},

	// ─── Canales ──────────────────────────────────────────────────────────────────
	{
		name: "teams_send_channel_message",
		description:
			"Envía un mensaje a un canal de un grupo/Team ya existente vía Azure Bot Framework, usando su conversationId. Soporta texto plano o HTML. El bot debe estar instalado en el Team.",
		inputSchema: {
			conversationId: z
				.string()
				.describe("conversationId del canal (ej: '19:...@thread.tacv2')."),
			content: z.string().describe("Contenido del mensaje"),
			contentType: z
				.enum(["text", "html"])
				.optional()
				.describe("Formato del contenido (default 'text')"),
		},
		handler: async ({
			conversationId,
			content,
			contentType,
		}: {
			conversationId: string;
			content: string;
			contentType?: "text" | "html";
		}) => {
			const data = await sendMessage(
				conversationId,
				content,
				contentType ?? "text",
			);
			await emit("message.sent", {
				scope: "channel",
				containerId: conversationId,
				messageId: data.id ?? "",
			});
			return ok(data);
		},
	},
];
