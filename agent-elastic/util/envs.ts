// ─── Environment variables ─────────────────────────────────────────────────
//
// El MCP de Elastic habla con Elasticsearch a través del *console proxy* de
// Kibana (`/s/<space>/api/console/proxy`). Solo se necesita la URL de Kibana,
// el space y, opcionalmente, credenciales (API key o cookie de sesión).

const {
	ELASTIC_KIBANA_URL,
	ELASTIC_SPACE,
	ELASTIC_API_KEY,
	ELASTIC_AUTH,
	SERVER_PORT,
	PORT,
} = process.env;

// URL base de Kibana (sin slash final). Ej: http://172.23.7.44:5601
const KIBANA_URL = (ELASTIC_KIBANA_URL || "http://172.23.7.44:5601").replace(
	/\/$/,
	"",
);

// Space de Kibana donde vive la vista Discover. Ej: dardo-dev
const SPACE = ELASTIC_SPACE || "dardo-dev";

// Autenticación opcional hacia Kibana:
//   - ELASTIC_API_KEY: valor de una API key de Elasticsearch (sin el prefijo).
//   - ELASTIC_AUTH:    header Authorization completo, ej "Basic xxx" o "ApiKey xxx".
const API_KEY = ELASTIC_API_KEY || "";
const AUTH_HEADER = ELASTIC_AUTH || "";

const PORT_NUM = Number(SERVER_PORT ?? PORT ?? 3003);

export const envs = {
	// Compatibilidad con el template (BASE_URL = URL de Kibana)
	BASE_URL: KIBANA_URL,
	KIBANA_URL,
	SPACE,
	API_KEY,
	AUTH_HEADER,
	PORT: PORT_NUM,
};
