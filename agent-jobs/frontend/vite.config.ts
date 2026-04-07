import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
// define .env

export default defineConfig((env) => {
	const envars = loadEnv(env.mode, "../");
	const SERVER_URL = envars.VITE_SERVER || "http://localhost:3100";
	return {
		envDir: "../../",
		plugins: [vue(), tailwindcss()],
		resolve: {
			alias: {
				"@": resolve("./src"),
			},
		},
		server: {
			port: 5173,
			proxy: {
				"/api": {
					target: SERVER_URL,
					changeOrigin: true,
				},
				"/ws": {
					target: SERVER_URL.replace(/^http/, "ws"),
					ws: true,
				},
			},
		},
	};
});
