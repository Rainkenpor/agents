import type { AtlassianHelpers } from "../types.ts";

// ─── Conversión wiki markup → storage XHTML vía endpoint oficial ─────────────
//
// Confluence Cloud no acepta markdown como representation, pero sí "wiki"
// (markup ligero muy parecido). Para la conversión usamos:
//   POST /wiki/rest/api/contentbody/convert/storage
// que recibe { value, representation } y devuelve { value, representation:"storage" }.

export async function wikiToStorage(
	h: AtlassianHelpers,
	value: string,
): Promise<string> {
	const res = (await h.apiPost(h.cfluUrl("contentbody/convert/storage"), {
		value,
		representation: "wiki",
	})) as { value: string };
	return res.value;
}
