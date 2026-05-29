const { resolveCacheDir } = require("./puppeteer.cache.cjs");

/**
 * Runtime configuration read by puppeteer.launch().
 *
 * Pins the browser cache to the same directory the install step writes to
 * (see puppeteer.cache.cjs), so a systemd service with an unset/empty $HOME
 * still finds the Chromium that was downloaded at deploy time.
 *
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
	cacheDir: resolveCacheDir(),
};
