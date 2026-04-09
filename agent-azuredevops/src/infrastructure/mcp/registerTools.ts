import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AzureConnection } from "../../domain/types.js";
import { HelmValuesGenerator } from "../../domain/services/HelmValuesGenerator.js";
import { RunRepoPipelinePlusUseCase } from "../../application/use-cases/RunRepoPipelinePlusUseCase.js";
import { RunRepoPipelineTriggerUseCase } from "../../application/use-cases/RunRepoPipelineTriggerUseCase.js";
import { RunRepoSelfServiceUseCase } from "../../application/use-cases/RunRepoSelfServiceUseCase.js";
import { AzureDevOpsHttpAdapter } from "../adapters/azuredevops/AzureDevOpsHttpAdapter.js";
import { ensureKebabCase, normalizeOrganization } from "../../shared/validation.js";

function buildConnection(organization: string | undefined, project: string, pat: string): AzureConnection {
  return {
    organization: normalizeOrganization(organization),
    project,
    pat,
  };
}

function text(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export const TOOL_CATALOG = [
  { name: "azdo_validate_pat", description: "Valida un PAT de Azure DevOps contra una organizacion." },
  { name: "azdo_check_repository", description: "Verifica que un repositorio exista en Azure DevOps." },
  { name: "azdo_create_repository", description: "Crea un repositorio en Azure DevOps de forma idempotente." },
  { name: "render_helm_values", description: "Genera un values.yaml de Helm como utilidad de soporte." },
  { name: "azdo_register_pipeline", description: "Registra un YAML existente como pipeline en Azure DevOps." },
  { name: "use_case_repo_selfservice", description: "Caso de uso que reemplaza repo-selfservice." },
  { name: "use_case_repo_pipeline_trigger", description: "Caso de uso que reemplaza repo-pipeline-trigger." },
  { name: "use_case_repo_pipeline_plus", description: "Caso de uso que reemplaza repo-pipeline-plus." }
] as const;

export function registerTools(server: McpServer): void {
  const azureDevOps = new AzureDevOpsHttpAdapter();
  const helmValuesGenerator = new HelmValuesGenerator();
  const runRepoSelfServiceUseCase = new RunRepoSelfServiceUseCase(azureDevOps, helmValuesGenerator);
  const runRepoPipelineTriggerUseCase = new RunRepoPipelineTriggerUseCase(azureDevOps);
  const runRepoPipelinePlusUseCase = new RunRepoPipelinePlusUseCase(azureDevOps);

  server.tool("azdo_validate_pat", "Valida un PAT de Azure DevOps. El PAT se usa solo en esta invocacion.", {
    organization: z.string().optional().describe("Organizacion de Azure DevOps. Default: grupodistelsa."),
    pat: z.string().describe("Personal Access Token de Azure DevOps."),
  }, async ({ organization, pat }) => ({
    content: [{ type: "text", text: text(await azureDevOps.validatePat(normalizeOrganization(organization), pat)) }],
  }));

  server.tool("azdo_check_repository", "Verifica que el repositorio exista y retorna sus datos principales.", {
    organization: z.string().optional(),
    project: z.string(),
    repo_name: z.string(),
    pat: z.string(),
  }, async ({ organization, project, repo_name, pat }) => {
    ensureKebabCase(repo_name, "repositorio");
    const repo = await azureDevOps.getRepository(buildConnection(organization, project, pat), repo_name);
    if (!repo) {
      return { isError: true, content: [{ type: "text", text: `El repositorio '${repo_name}' no existe en '${project}'.` }] };
    }
    return { content: [{ type: "text", text: text(repo) }] };
  });

  server.tool("azdo_create_repository", "Crea el repositorio si no existe y espera hasta que Azure DevOps lo deje listo para pushes.", {
    organization: z.string().optional(),
    project: z.string(),
    repo_name: z.string(),
    pat: z.string(),
  }, async ({ organization, project, repo_name, pat }) => {
    ensureKebabCase(repo_name, "repositorio");
    const result = await azureDevOps.ensureRepository(buildConnection(organization, project, pat), repo_name);
    return { content: [{ type: "text", text: text({ ...result.repo, isNew: result.isNew }) }] };
  });

  server.tool("render_helm_values", "Genera el values.yaml de Helm con las reglas actuales del proyecto.", {
    app_repo_name: z.string(),
    image_project: z.string(),
    replica_count: z.number().int().positive().default(1),
    has_service: z.boolean(),
    service_port: z.number().int().positive().optional(),
    has_ingress: z.boolean(),
    hosting: z.enum(["On-Premise", "AWS"]).optional(),
    web_host: z.string().optional(),
    alb_name: z.string().optional(),
    branch: z.string().default("{{BRANCH}}"),
  }, async ({ app_repo_name, image_project, replica_count, has_service, service_port, has_ingress, hosting, web_host, alb_name, branch }) => {
    const result = helmValuesGenerator.generate({
      appRepoName: app_repo_name,
      imageProject: image_project,
      replicaCount: replica_count,
      hasService: has_service,
      servicePort: service_port ?? 80,
      hasIngress: has_ingress,
      hosting,
      webHost: web_host,
      albName: alb_name,
      branch,
    });
    return { content: [{ type: "text", text: text(result) }] };
  });

  server.tool("azdo_register_pipeline", "Registra un archivo YAML existente como pipeline en Azure DevOps.", {
    organization: z.string().optional(),
    project: z.string(),
    repo_name: z.string(),
    branch: z.string(),
    pat: z.string(),
    yaml_path: z.string().optional(),
    pipeline_name: z.string().optional(),
    pipeline_folder: z.string().optional(),
  }, async ({ organization, project, repo_name, branch, pat, yaml_path, pipeline_name, pipeline_folder }) => {
    ensureKebabCase(repo_name, "repositorio");
    const result = await azureDevOps.registerPipeline(buildConnection(organization, project, pat), repo_name, branch, yaml_path, pipeline_name, pipeline_folder);
    return { content: [{ type: "text", text: text(result) }] };
  });

  server.tool("use_case_repo_selfservice", "Caso de uso que reemplaza repo-selfservice.", {
    pat: z.string(),
    project: z.string(),
    repo_name: z.string(),
    image_project: z.string(),
    organization: z.string().optional(),
    replica_count: z.number().int().positive().default(1),
    has_service: z.boolean(),
    service_port: z.number().int().positive().optional(),
    has_ingress: z.boolean(),
    hosting: z.enum(["On-Premise", "AWS"]).optional(),
    web_host: z.string().optional(),
    alb_name: z.string().optional(),
    target_repo: z.string().default("self-service-devops"),
  }, async ({ pat, project, repo_name, image_project, organization, replica_count, has_service, service_port, has_ingress, hosting, web_host, alb_name, target_repo }) => {
    ensureKebabCase(repo_name, "repositorio");
    ensureKebabCase(target_repo, "repositorio");
    const result = await runRepoSelfServiceUseCase.execute({
      connection: buildConnection(organization, project, pat),
      repoName: repo_name,
      imageProject: image_project,
      replicaCount: replica_count,
      hasService: has_service,
      servicePort: service_port ?? 80,
      hasIngress: has_ingress,
      hosting,
      webHost: web_host,
      albName: alb_name,
      targetRepo: target_repo,
    });
    return { content: [{ type: "text", text: text(result) }] };
  });

  server.tool("use_case_repo_pipeline_trigger", "Caso de uso que reemplaza repo-pipeline-trigger.", {
    pat: z.string(),
    project: z.string(),
    repo_name: z.string(),
    organization: z.string().optional(),
  }, async ({ pat, project, repo_name, organization }) => {
    ensureKebabCase(repo_name, "repositorio");
    const result = await runRepoPipelineTriggerUseCase.execute(buildConnection(organization, project, pat), repo_name);
    return { content: [{ type: "text", text: text(result) }] };
  });

  server.tool("use_case_repo_pipeline_plus", "Caso de uso que reemplaza repo-pipeline-plus.", {
    pat: z.string(),
    organization: z.string().optional(),
    project: z.string(),
    repo_name: z.string(),
    branch: z.enum(["develop", "QA", "staging", "main"]),
    ambiente: z.enum(["onpremise", "cloud"]),
    tecnologia: z.enum(["nodejs", "netcore", "vite", "react", "angular", "netframework", "python", "flutter"]),
    sonar_key: z.string(),
    sonar_name: z.string(),
    csproj: z.string().optional(),
  }, async ({ pat, organization, project, repo_name, branch, ambiente, tecnologia, sonar_key, sonar_name, csproj }) => {
    ensureKebabCase(repo_name, "repositorio");
    const result = await runRepoPipelinePlusUseCase.execute({
      connection: buildConnection(organization, project, pat),
      repositorio: repo_name,
      rama: branch,
      ambiente,
      tecnologia,
      sonarKey: sonar_key,
      sonarName: sonar_name,
      csproj,
    });
    return { content: [{ type: "text", text: text(result) }] };
  });
}
