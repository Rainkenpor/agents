// Remover de un json cualquier campo que tenga un valor null o undefined, incluso si el valor es un objeto o un array que contiene campos con valores null o undefined.
export function removeNullUndefined(obj: any): any {
	if (Array.isArray(obj)) {
		return obj
			.filter((item: any) => item !== null && item !== undefined)
			.map((item: any) => removeNullUndefined(item));
	}
	if (typeof obj === "object" && obj !== null) {
		const newObj: any = {};
		for (const [key, value] of Object.entries(obj)) {
			if (value !== null && value !== undefined) {
				newObj[key] = removeNullUndefined(value);
			}
		}
		return newObj;
	}
	return obj;
}
