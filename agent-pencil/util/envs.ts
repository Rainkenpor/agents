const {
	SERVER_BASE_URL,
	SERVER_PORT,
	PENCIL_LIB_PATHS,
	PENCIL_OUTPUT_DIR,
} = process.env;

const BASE_URL = SERVER_BASE_URL || "http://localhost:3000";
const PORT = Number(SERVER_PORT ?? 3000);

export const envs = {
	BASE_URL,
	PORT,
	PENCIL_LIB_PATHS: PENCIL_LIB_PATHS ?? "",
	PENCIL_OUTPUT_DIR: PENCIL_OUTPUT_DIR ?? "./output",
};
