const { SERVER_BASE_URL, SERVER_PORT, DATA_DIR } = process.env;

const BASE_URL = SERVER_BASE_URL || "http://localhost:3000";
const PORT = Number(SERVER_PORT ?? 3000);

export const envs = {
	BASE_URL,
	PORT,
	/** Base data directory — repos are cloned to $DATA_DIR/agent/<repo-name> */
	DATA_DIR: DATA_DIR ?? "",
};
