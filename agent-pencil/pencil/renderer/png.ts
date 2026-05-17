import { Resvg } from "@resvg/resvg-js";

export function svgToPng(svg: string, scale = 1): Buffer {
	const resvg = new Resvg(svg, {
		fitTo: scale === 1 ? { mode: "original" } : { mode: "zoom", value: scale },
		background: "rgba(0,0,0,0)",
		font: { loadSystemFonts: true },
	});
	return resvg.render().asPng();
}
