// ─── Azure DevOps Tools ───────────────────────────────────────────────────────
//
// Expone los 3 use-cases como tools MCP.
// Los adapters y generadores se instancian una vez a nivel de módulo (singletons).

import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { ok } from "../types.js";
import { AzureDevOpsHttpAdapter } from "../infrastructure/adapters/azuredevops/AzureDevOpsHttpAdapter.js";
import { HelmValuesGenerator } from "../domain/services/HelmValuesGenerator.js";
import { RunRepoPipelinePlusUseCase } from "../application/use-cases/RunRepoPipelinePlusUseCase.js";
import { RunRepoPipelineTriggerUseCase } from "../application/use-cases/RunRepoPipelineTriggerUseCase.js";
import { RunRepoSelfServiceUseCase } from "../application/use-cases/RunRepoSelfServiceUseCase.js";
import { ensureKebabCase, normalizeOrganization } from "../shared/validation.js";
import { getDefaultOrganization } from "../shared/config.js";
import type { AzureConnection } from "../domain/types.js";

// ─── Singletons ───────────────────────────────────────────────────────────────
const azureDevOps = new AzureDevOpsHttpAdapter();
const helmValuesGenerator = new HelmValuesGenerator();
const runRepoSelfServiceUseCase = new RunRepoSelfServiceUseCase(azureDevOps, helmValuesGenerator);
const runRepoPipelineTriggerUseCase = new RunRepoPipelineTriggerUseCase(azureDevOps);
const runRepoPipelinePlusUseCase = new RunRepoPipelinePlusUseCase(azureDevOps);

function buildConnection(organization: string | undefined, project: string, pat: string): AzureConnection {
  return {
    organization: normalizeOrganization(organization),
    project,
    pat,
  };
}

// ─── Tool definitions ─────────────────────────────────────────────────────────
//
// Solo se exponen los use-cases como tools MCP.
// Las operaciones de infraestructura (azdo_*, render_*) son internas y se
// invocan exclusivamente desde los use-cases, no directamente por agentes.

export const azureDevOpsTools: ToolDefinition[] = [
  {
    name: "use_case_repo_selfservice",
    description: "Caso de negocio para publicar values.yaml de Helm del componente en self-service-devops para develop, QA, staging y main.",
    inputSchema: {
      pat: z.string().describe("Personal Access Token con permisos sobre el repo origen y el repo destino."),
      project: z.string().describe("Proyecto de Azure DevOps donde viven los repositorios."),
      repo_name: z.string().describe("Repositorio de la aplicacion en kebab-case."),
      image_project: z.string().describe("Proyecto o namespace de imagenes usado en Helm."),
      organization: z.string().optional().describe(`Organizacion de Azure DevOps. Default: ${getDefaultOrganization()}.`),
      replica_count: z.number().int().positive().default(1).describe("Cantidad inicial de replicas."),
      has_service: z.boolean().describe("Indica si la app necesita Service."),
      service_port: z.number().int().positive().optional().describe("Puerto del Service. Si no llega, se usa 80."),
      has_ingress: z.boolean().describe("Indica si se debe publicar Ingress."),
      hosting: z.enum(["On-Premise", "AWS"]).optional().describe("Tipo de hosting para ajustar Ingress."),
      web_host: z.string().optional().describe("Hostname del Ingress."),
      alb_name: z.string().optional().describe("Nombre del ALB cuando hosting es AWS."),
      target_repo: z.string().default("self-service-devops").describe("Repositorio destino donde se escriben los values."),
    },
    handler: async ({
      pat,
      project,
      repo_name,
      image_project,
      organization,
      replica_count,
      has_service,
      service_port,
      has_ingress,
      hosting,
      web_host,
      alb_name,
      target_repo,
    }: {
      pat: string;
      project: string;
      repo_name: string;
      image_project: string;
      organization?: string;
      replica_count: number;
      has_service: boolean;
      service_port?: number;
      has_ingress: boolean;
      hosting?: "On-Premise" | "AWS";
      web_host?: string;
      alb_name?: string;
      target_repo: string;
    }) => {
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
      return ok(result);
    },
  },

  {
    name: "use_case_repo_pipeline_trigger",
    description: "Caso de negocio para registrar los cuatro pipelines estandar una vez que sus YAML ya existen en el repositorio.",
    inputSchema: {
      pat: z.string().describe("Personal Access Token con permisos para leer el repo y crear pipelines."),
      project: z.string().describe("Proyecto de Azure DevOps."),
      repo_name: z.string().describe("Repositorio objetivo en kebab-case."),
      organization: z.string().optional().describe(`Organizacion de Azure DevOps. Default: ${getDefaultOrganization()}.`),
    },
    handler: async ({ pat, project, repo_name, organization }: { pat: string; project: string; repo_name: string; organization?: string }) => {
      ensureKebabCase(repo_name, "repositorio");
      const result = await runRepoPipelineTriggerUseCase.execute(buildConnection(organization, project, pat), repo_name);
      return ok(result);
    },
  },

  {
    name: "use_case_repo_pipeline_plus",
    description: "Caso de negocio para generar un YAML CI/CD soportado, subirlo a una rama de trabajo y abrir un PR hacia develop, QA, staging o main.",
    inputSchema: {
      pat: z.string().describe("Personal Access Token con permisos para crear ramas, pushes y PRs."),
      organization: z.string().optional().describe(`Organizacion de Azure DevOps. Default: ${getDefaultOrganization()}.`),
      project: z.string().describe("Proyecto de Azure DevOps."),
      repo_name: z.string().describe("Repositorio objetivo en kebab-case."),
      branch: z.enum(["develop", "QA", "staging", "main"]).describe("Rama destino donde debe terminar el YAML."),
      ambiente: z.enum(["onpremise", "cloud"]).describe("Tipo de despliegue soportado por las plantillas."),
      tecnologia: z.enum(["nodejs", "netcore", "vite", "react", "angular", "netframework", "python", "flutter"]).describe("Stack de la aplicacion. Solo algunas combinaciones tienen plantilla real."),
      sonar_key: z.string().describe("Project key de SonarQube."),
      sonar_name: z.string().describe("Nombre visible del proyecto en SonarQube."),
      csproj: z.string().optional().describe("Ruta del .csproj cuando la tecnologia es netcore."),
    },
    handler: async ({
      pat,
      organization,
      project,
      repo_name,
      branch,
      ambiente,
      tecnologia,
      sonar_key,
      sonar_name,
      csproj,
    }: {
      pat: string;
      organization?: string;
      project: string;
      repo_name: string;
      branch: "develop" | "QA" | "staging" | "main";
      ambiente: "onpremise" | "cloud";
      tecnologia: "nodejs" | "netcore" | "vite" | "react" | "angular" | "netframework" | "python" | "flutter";
      sonar_key: string;
      sonar_name: string;
      csproj?: string;
    }) => {
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
      return ok(result);
    },
  },
];
