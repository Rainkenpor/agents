const { join } = require("node:path");

/**
 * Single source of truth for where Puppeteer's browser binary lives.
 *
 * Used by both .puppeteerrc.cjs (runtime: puppeteer.launch) and
 * scripts/install-browser.mjs (download time), so the install location and the
 * runtime lookup can never drift apart.
 *
 * Resolution order:
 *  1. PUPPETEER_CACHE_DIR env var (set this in your systemd unit for a shared
 *     path like /var/lib/agent-pencil/.puppeteer-cache).
 *  2. A project-local .puppeteer-cache dir — stable regardless of $HOME, which
 *     is the usual failure mode for systemd services using the default
 *     ~/.cache/puppeteer.
 */
function resolveCacheDir() {
	return process.env.PUPPETEER_CACHE_DIR || join(__dirname, ".puppeteer-cache");
}

module.exports = { resolveCacheDir };
