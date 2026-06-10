const {
	SERVER_BASE_URL,
	SERVER_PORT,
	SONAR_BASE_URL,
	SONAR_TOKEN,
} = process.env;

// URL base de la instancia SonarQube (sin /api ni /projects al final)
const BASE_URL = (SONAR_BASE_URL || SERVER_BASE_URL || "https://sup.gdsas.com")
	.replace(/\/projects\/?$/, "")
	.replace(/\/$/, "");

const PORT = Number(SERVER_PORT ?? 3003);

export const envs = {
	BASE_URL,
	PORT,
	/** Token de autenticación de usuario/global de SonarQube */
	SONAR_TOKEN: SONAR_TOKEN ?? "",
};
