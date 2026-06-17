// ─── Environment variables ─────────────────────────────────────────────────
//
// El MCP de Elastic habla DIRECTAMENTE con Elasticsearch (puerto 9200),
// sin pasar por Kibana: cada petición va a `{ELASTIC_URL}{path}` con el verbo
// HTTP real. Solo se necesita la URL de Elasticsearch y, opcionalmente,
// credenciales (API key o header Authorization completo).

const { ELASTIC_URL, ELASTIC_API_KEY, ELASTIC_AUTH, SERVER_PORT, PORT } =
	process.env;

// URL base de Elasticsearch (sin slash final). Ej: http://172.23.7.44:9200
const ES_URL = (ELASTIC_URL || "http://172.23.7.44:9200").replace(/\/$/, "");

// Autenticación opcional hacia Elasticsearch:
//   - ELASTIC_API_KEY: valor de una API key (se envía como "ApiKey <valor>").
//   - ELASTIC_AUTH:    header Authorization completo, ej "Basic xxx" o "ApiKey xxx".
const API_KEY = ELASTIC_API_KEY || "";
const AUTH_HEADER = ELASTIC_AUTH || "";

const PORT_NUM = Number(SERVER_PORT ?? PORT ?? 3003);

export const envs = {
	// Compatibilidad con el template (BASE_URL = URL de Elasticsearch)
	BASE_URL: ES_URL,
	ES_URL,
	API_KEY,
	AUTH_HEADER,
	PORT: PORT_NUM,
};
