import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Compiles Tailwind v4 + DaisyUI CSS by scanning the given HTML fragment.
 * Runs the @tailwindcss/cli binary from the project root so it can resolve
 * `tailwindcss` and `daisyui` from this package's node_modules.
 */
export async function compileCss(htmlFragment: string): Promise<string> {
	const dir = await mkdtemp(join(PROJECT_ROOT, ".pencil-tw-"));
	const inputPath = join(dir, "input.css");
	const htmlPath = join(dir, "page.html");
	const outputPath = join(dir, "out.css");

	const inputCss = `@import "tailwindcss";\n@plugin "daisyui";\n@source "${htmlPath.replace(/\\/g, "/")}";\n`;
	await writeFile(inputPath, inputCss, "utf8");
	await writeFile(htmlPath, htmlFragment, "utf8");

	try {
		await runTailwind(inputPath, outputPath);
		return await readFile(outputPath, "utf8");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function runTailwind(input: string, output: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const bin = process.platform === "win32" ? "bunx.exe" : "bunx";
		const child = spawn(
			bin,
			["--bun", "@tailwindcss/cli", "-i", input, "-o", output],
			{ stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" },
		);
		let stderr = "";
		child.stderr.on("data", (d) => {
			stderr += d.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`tailwindcss exited ${code}: ${stderr}`));
		});
	});
}
