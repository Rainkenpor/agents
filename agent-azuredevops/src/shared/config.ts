const DEFAULT_AZDO_ORGANIZATION = "grupodistelsa";

export function getDefaultOrganization(): string {
  return process.env["AZDO_ORGANIZATION"]?.trim() || DEFAULT_AZDO_ORGANIZATION;
}
