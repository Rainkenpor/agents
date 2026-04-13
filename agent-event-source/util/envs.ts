const { SERVER_BASE_URL, SERVER_PORT, GIT_POLL_INTERVAL_MINUTES } =
	process.env;

const BASE_URL = SERVER_BASE_URL || "http://localhost:3000";
const PORT = Number(SERVER_PORT ?? 3000);

/** How often (in minutes) to poll all git repositories for changes. Default: 20. */
const GIT_POLL_INTERVAL = Number(GIT_POLL_INTERVAL_MINUTES ?? 20);

export const envs = {
	BASE_URL,
	PORT,
	GIT_POLL_INTERVAL,
};
