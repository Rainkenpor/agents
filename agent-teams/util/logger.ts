import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger, format, transports } from "winston";

const { combine, timestamp, printf } = format;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Crear directorio de logs si no existe
const logsDir = join(__dirname, "../logs");
if (!existsSync(logsDir)) {
	mkdirSync(logsDir, { recursive: true });
}

const logFormat = printf(({ level, message, timestamp: ts }) => {
	const levelUpper = (level as string).toUpperCase();
	return `${ts} [${levelUpper}]: ${message}`;
});

export const logger = createLogger({
	level: "info",
	format: combine(timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), logFormat),
	transports: [
		new transports.File({
			filename: join(logsDir, "agents.log"),
			maxsize: 5242880, // 5MB
			maxFiles: 5,
		}),
	],
});
