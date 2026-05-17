import PDFDocument from "pdfkit";
// @ts-ignore - svg-to-pdfkit has no types
import SVGtoPDF from "svg-to-pdfkit";

export async function svgsToPdfBuffer(svgs: string[]): Promise<Buffer> {
	return await new Promise((resolve, reject) => {
		const doc = new PDFDocument({ autoFirstPage: false });
		const chunks: Buffer[] = [];
		doc.on("data", (c: Buffer) => chunks.push(c));
		doc.on("end", () => resolve(Buffer.concat(chunks)));
		doc.on("error", reject);
		try {
			for (const svg of svgs) {
				const w = extractDim(svg, "width") ?? 800;
				const h = extractDim(svg, "height") ?? 600;
				doc.addPage({ size: [w, h], margin: 0 });
				SVGtoPDF(doc, svg, 0, 0, { width: w, height: h, preserveAspectRatio: "xMinYMin meet" });
			}
			doc.end();
		} catch (err) {
			reject(err);
		}
	});
}

function extractDim(svg: string, attr: "width" | "height"): number | null {
	const m = svg.match(new RegExp(`${attr}="(\\d+(?:\\.\\d+)?)"`));
	return m ? Number(m[1]) : null;
}
