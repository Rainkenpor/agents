const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function kebabError(value: string, kind: string): string {
  return `El ${kind} "${value}" no sigue la nomenclatura del equipo. Usa kebab-case, por ejemplo "mi-${kind}".`;
}

export function ensureNonEmpty(value: string, label: string): string {
  if (!value.trim()) {
    throw new Error(`${label} es obligatorio.`);
  }
  return value;
}

export function ensureKebabCase(value: string, kind: string): string {
  ensureNonEmpty(value, kind);
  if (!KEBAB_RE.test(value)) {
    throw new Error(kebabError(value, kind));
  }
  return value;
}

export function normalizeOrganization(value?: string): string {
  return value?.trim() || "grupodistelsa";
}
