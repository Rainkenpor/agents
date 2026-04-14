import type { AzureConnection, PipelineInfo } from "../../domain/types.js";
import { encodeSegment, httpsGetOrNull, httpsRequest } from "../../shared/http.js";
import { createAzureContext } from "./client.js";
import { waitForRepositoryReadiness } from "./repositories.js";

const BRANCH_PREFIX: Record<string, string> = {
  develop: "dev",
  QA: "qa",
  staging: "stg",
  main: "main",
};

export async function registerPipeline(connection: AzureConnection, repoName: string, branch: string, yamlPath?: string, pipelineName?: string, pipelineFolder = "\\"): Promise<PipelineInfo & { yamlPath: string; repoName: string }> {
  const ctx = createAzureContext(connection);
  const repo = await waitForRepositoryReadiness(connection, repoName);
  const resolvedYamlPath = yamlPath
    ? (yamlPath.startsWith("/") ? yamlPath : `/${yamlPath}`)
    : `/pipelines/${BRANCH_PREFIX[branch] ?? branch.toLowerCase()}-cicd-${repoName}.yaml`;
  const resolvedPipelineName = pipelineName || resolvedYamlPath.split("/").pop()?.replace(/\.yaml$/i, "") || repoName;

  const yamlItem = await httpsGetOrNull<unknown>({
    hostname: "dev.azure.com",
    path: `${ctx.repositoriesPath}/${encodeSegment(repoName)}/items?path=${encodeURIComponent(resolvedYamlPath)}&versionDescriptor.version=${encodeURIComponent(branch)}&api-version=7.1`,
    method: "GET",
    headers: ctx.headers,
  });

  if (!yamlItem) {
    throw new Error(`El archivo YAML '${resolvedYamlPath}' no existe en la rama '${branch}' del repositorio '${repoName}'.`);
  }

  const existing = await httpsGetOrNull<{ value: Array<{ id: number; name: string }> }>({
    hostname: "dev.azure.com",
    path: `${ctx.pipelinesPath}?api-version=7.1`,
    method: "GET",
    headers: ctx.headers,
  });

  const found = existing?.value?.find((pipeline) => pipeline.name.toLowerCase() === resolvedPipelineName.toLowerCase());
  if (found) {
    return {
      pipelineId: found.id,
      pipelineName: found.name,
      repoName: repo.name,
      yamlPath: resolvedYamlPath,
      status: "already_exists",
      url: `${ctx.webProjectBase}/_build?definitionId=${found.id}`,
    };
  }

  const created = await httpsRequest<{ id: number; name: string; _links?: { web?: { href: string } } }>({
    hostname: "dev.azure.com",
    path: `${ctx.pipelinesPath}?api-version=7.1`,
    method: "POST",
    headers: ctx.headers,
  }, JSON.stringify({
    name: resolvedPipelineName,
    folder: pipelineFolder,
    configuration: {
      type: "yaml",
      path: resolvedYamlPath,
      repository: {
        id: repo.id,
        type: "azureReposGit",
        defaultBranch: `refs/heads/${branch}`,
      },
    },
  }));

  return {
    pipelineId: created.id,
    pipelineName: created.name,
    repoName: repo.name,
    yamlPath: resolvedYamlPath,
    status: "created",
    url: created._links?.web?.href ?? `${ctx.webProjectBase}/_build?definitionId=${created.id}`,
  };
}
