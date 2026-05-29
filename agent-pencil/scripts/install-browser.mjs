// Downloads the Chromium that Puppeteer will drive, into the SAME cache dir the
// runtime resolves (see .puppeteerrc.cjs). The `puppeteer browsers install` CLI
// does not read .puppeteerrc.cjs, but it does honor PUPPETEER_CACHE_DIR — so we
// set it here from the shared resolver, guaranteeing install and runtime agree
// regardless of $HOME (important under systemd).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveCacheDir } from "../puppeteer.cache.cjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cacheDir = resolveCacheDir();

const cli = join(
	__dirname,
	"..",
	"node_modules",
	"puppeteer",
	"lib",
	"cjs",
	"puppeteer",
	"node",
	"cli.js",
);

const res = spawnSync(
	process.execPath,
	[cli, "browsers", "install", "chrome"],
	{
		stdio: "inherit",
		env: { ...process.env, PUPPETEER_CACHE_DIR: cacheDir },
	},
);

process.exit(res.status ?? 0);
