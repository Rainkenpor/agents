import type { AzureConnection } from "../../domain/types.js";
import { encodeSegment } from "../../shared/http.js";

export function createAzureHeaders(pat: string): Record<string, string> {
  const auth = Buffer.from(`:${pat}`).toString("base64");
  return {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

export function createAzureContext(connection: AzureConnection) {
  const { organization, project, pat } = connection;
  const headers = createAzureHeaders(pat);
  const encodedOrganization = encodeSegment(organization);
  const encodedProject = encodeSegment(project);

  return {
    headers,
    encodedOrganization,
    encodedProject,
    repositoriesPath: `/${encodedOrganization}/${encodedProject}/_apis/git/repositories`,
    pipelinesPath: `/${encodedOrganization}/${encodedProject}/_apis/pipelines`,
    webProjectBase: `https://dev.azure.com/${encodedOrganization}/${encodedProject}`,
  };
}
