// ─── Azure DevOps Tools ───────────────────────────────────────────────────────
//
// Expone los 3 use-cases como tools MCP.
// Los adapters y generadores se instancian una vez a nivel de módulo (singletons).

import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { ok } from "../types.js";
import { AzureDevOpsHttpAdapter } from "../infrastructure/adapters/azuredevops/AzureDevOpsHttpAdapter.js";
import { HelmValuesGenerator } from "../domain/services/HelmValuesGenerator.js";
import { CreatePipelineYamlUseCase } from "../application/use-cases/CreatePipelineYamlUseCase.js";
import { RegisterPipelinesUseCase } from "../application/use-cases/RegisterPipelinesUseCase.js";
import { CreateSelfServiceRepositoryUseCase } from "../application/use-cases/CreateSelfServiceRepositoryUseCase.js";
import { AuditRepoNamingUseCase } from "../application/use-cases/AuditRepoNamingUseCase.js";
import { ValidatePipelineStandardizationUseCase } from "../application/use-cases/ValidatePipelineStandardizationUseCase.js";
import { ensureKebabCase, normalizeOrganization } from "../shared/validation.js";
import { getDefaultOrganization } from "../shared/config.js";
import type { AzureConnection } from "../domain/types.js";

// ─── Singletons ───────────────────────────────────────────────────────────────
const azureDevOps = new AzureDevOpsHttpAdapter();
const helmValuesGenerator = new HelmValuesGenerator();
const createSelfServiceRepositoryUseCase = new CreateSelfServiceRepositoryUseCase(azureDevOps, helmValuesGenerator);
const registerPipelinesUseCase = new RegisterPipelinesUseCase(azureDevOps);
const createPipelineYamlUseCase = new CreatePipelineYamlUseCase(azureDevOps);
const auditRepoNamingUseCase = new AuditRepoNamingUseCase(azureDevOps);
const validatePipelineStandardizationUseCase = new ValidatePipelineStandardizationUseCase();

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
    name: "use_case_create_selfservice_repository",
    description: [
      "Genera y publica archivos values.yaml de Helm para Kubernetes en el repositorio self-service-devops (o el repo destino indicado).",
      "Crea un values.yaml por rama estandar (develop, QA, staging, main) bajo la ruta /<repo_name>/helm/values.yaml.",
      "Si el repositorio destino no existe, lo crea automaticamente.",
      "En repos nuevos hace push directo; en repos existentes crea una rama auxiliar '<branch>-pipeline' y abre un PR.",
      "Prerequisito: el repositorio de la aplicacion (repo_name) debe existir previamente en el proyecto de Azure DevOps.",
      "PAT requerido: Code (Read & Write) sobre el repo origen y el repo destino.",
    ].join(" "),
    inputSchema: {
      project: z.string().describe("Nombre exacto del proyecto de Azure DevOps donde viven ambos repositorios."),
      repo_name: z.string().describe("Nombre del repositorio de la aplicacion en kebab-case (ej: 'mi-servicio'). Debe existir en el proyecto."),
      image_project: z.string().describe("Proyecto o namespace de imagenes de contenedor usado en el campo image.repository del Helm chart (ej: 'acr-distelsa/backend')."),
      organization: z.string().optional().describe(`Nombre de la organizacion en Azure DevOps. Si se omite, se usa '${getDefaultOrganization()}'.`),
      replica_count: z.number().int().positive().default(1).describe("Numero inicial de replicas del Deployment de Kubernetes. Default: 1."),
      has_service: z.boolean().describe("Si es true, el values.yaml incluye la seccion Service habilitada. Requerido para que la app sea accesible dentro del cluster."),
      service_port: z.number().int().positive().optional().describe("Puerto TCP expuesto por el Service de Kubernetes. Si se omite, se usa 80."),
      has_ingress: z.boolean().describe("Si es true, el values.yaml incluye la seccion Ingress habilitada para exponer la app al exterior."),
      hosting: z.enum(["On-Premise", "AWS"]).optional().describe("Tipo de infraestructura. 'On-Premise' usa ingress class 'nginx'; 'AWS' usa 'alb' con anotaciones de AWS Load Balancer Controller."),
      web_host: z.string().optional().describe("Hostname del Ingress (ej: 'mi-app.empresa.com'). Si se omite, se genera con 'example.local' como placeholder."),
      alb_name: z.string().optional().describe("Nombre del grupo ALB compartido (anotacion alb.ingress.kubernetes.io/group.name). Solo aplica cuando hosting es 'AWS'. Default: 'shared-alb'."),
      target_repo: z.string().default("self-service-devops").describe("Repositorio destino donde se escriben los values.yaml. Default: 'self-service-devops'."),
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
      pat: string; // inyectado desde el header mcp-pat
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
      const result = await createSelfServiceRepositoryUseCase.execute({
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
    name: "use_case_register_pipelines",
    description: [
      "Registra los cuatro pipelines CI/CD estandar en Azure DevOps para un repositorio dado.",
      "Los pipelines corresponden a las ramas develop, QA, staging y main.",
      "Cada pipeline apunta al YAML en la ruta 'pipelines/<prefijo>-cicd-<repo>.yaml' de su rama (dev, qa, stg, main).",
      "Verifica que los cuatro archivos YAML existan antes de registrar; si falta alguno, falla indicando cuales.",
      "Es idempotente: si un pipeline ya estaba registrado, lo reporta como 'already_exists' sin modificarlo.",
      "Prerequisito: los cuatro archivos YAML de pipeline deben existir en sus ramas. Usa use_case_repo_pipeline_plus para generarlos.",
      "PAT requerido: Code (Read) y Build (Read & Execute).",
    ].join(" "),
    inputSchema: {
      project: z.string().describe("Nombre exacto del proyecto de Azure DevOps."),
      repo_name: z.string().describe("Nombre del repositorio objetivo en kebab-case. Los cuatro archivos YAML deben existir en sus ramas correspondientes."),
      organization: z.string().optional().describe(`Nombre de la organizacion en Azure DevOps. Si se omite, se usa '${getDefaultOrganization()}'.`),
    },
    handler: async ({ pat, project, repo_name, organization }: { pat: string; project: string; repo_name: string; organization?: string }) => {
      ensureKebabCase(repo_name, "repositorio");
      const result = await registerPipelinesUseCase.execute(buildConnection(organization, project, pat), repo_name);
      return ok(result);
    },
  },

  {
    name: "use_case_create_pipeline_yaml",
    description: [
      "Genera un archivo YAML de pipeline CI/CD a partir de plantillas estandar, lo sube a una rama de trabajo y abre un Pull Request hacia la rama destino.",
      "El YAML generado configura dos stages: CI (usando plantilla del repo cicd-blueprints) y CD (GitOps hacia K8s via self-service-devops).",
      "La rama de trabajo se llama '<branch>-pipeline-create' y el archivo se guarda en 'pipelines/<prefijo>-cicd-<repo>.yaml'.",
      "Es idempotente: si el archivo ya existe en la rama destino, no hace push ni crea PR y devuelve pipelineAlreadyExists=true.",
      "Solo funciona para combinaciones de ambiente+tecnologia con plantilla real: nodejs/vite/netcore/react en onpremise o cloud.",
      "Para angular/netframework/python/flutter no hay plantilla; usa use_case_repo_pipeline_trigger con un YAML propio.",
      "PAT requerido: Code (Read & Write) para ramas, pushes y PRs.",
    ].join(" "),
    inputSchema: {
      organization: z.string().optional().describe(`Nombre de la organizacion en Azure DevOps. Si se omite, se usa '${getDefaultOrganization()}'.`),
      project: z.string().describe("Nombre exacto del proyecto de Azure DevOps donde vive el repositorio."),
      repo_name: z.string().describe("Nombre del repositorio objetivo en kebab-case. El repositorio debe existir previamente en el proyecto."),
      branch: z.enum(["develop", "QA", "staging", "main"]).describe("Rama destino donde debe quedar el YAML de pipeline una vez mergeado el PR. La rama debe existir en el repositorio."),
      ambiente: z.enum(["onpremise", "cloud"]).describe("Tipo de infraestructura: 'onpremise' (Kubernetes on-premise con Nginx Ingress) o 'cloud' (AWS EKS con ALB)."),
      tecnologia: z.enum(["nodejs", "netcore", "vite", "react", "angular", "netframework", "python", "flutter"]).describe("Stack tecnologico de la aplicacion. Combinaciones con plantilla real: nodejs, vite, netcore, react (en ambos ambientes). Las demas fallan con error explicativo."),
      sonar_key: z.string().describe("Project key del proyecto en SonarQube (se obtiene del area de QA). Se inyecta como variable 'sonarQubeProjectKey' en el pipeline."),
      sonar_name: z.string().describe("Nombre visible del proyecto en SonarQube (se muestra en el dashboard). Se inyecta como variable 'sonarQubeProjectName'."),
      csproj: z.string().optional().describe("Ruta relativa al archivo .csproj de publicacion (ej: 'src/MiApp/MiApp.csproj'). Requerido cuando tecnologia es 'netcore'."),
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
      pat: string; // inyectado desde el header mcp-pat
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
      const result = await createPipelineYamlUseCase.execute({
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

  {
    name: "use_case_audit_repo_naming",
    description: [
      "Lista todos los repositorios de la organización de Azure DevOps cuyo nombre NO sigue la convencion kebab-case (solo minusculas, numeros y guiones, sin espacios ni mayusculas).",
      "Recorre todos los proyectos visibles de la organizacion y devuelve unicamente los repos con nombre incorrecto, agrupados por proyecto.",
      "Util para auditar y detectar repositorios mal nombrados antes de onboardearlos al pipeline CI/CD.",
      "No requiere un proyecto especifico: opera a nivel de organizacion completa.",
      "PAT requerido: solo lectura de proyectos y repositorios (Project Read + Code Read).",
    ].join(" "),
    inputSchema: {
      organization: z.string().optional().describe(`Nombre de la organizacion en Azure DevOps. Si se omite, se usa '${getDefaultOrganization()}'.`),
    },
    handler: async ({ pat, organization }: { pat: string; organization?: string }) => {
      const result = await auditRepoNamingUseCase.execute({
        connection: buildConnection(organization, "", pat),
      });
      return ok(result);
    },
  },

  {
    name: "use_case_validate_pipeline_standardization",
    description: [
      "Valida el estado de estandarización de pipelines de un repositorio en Azure DevOps.",
      "Verifica: (1) existencia de archivos YAML en la carpeta /pipelines del repositorio,",
      "(2) estructura interna de los YAML (claves trigger y stages),",
      "(3) existencia del repositorio self-service-devops en el proyecto,",
      "(4) presencia de la carpeta con valores Helm para el repositorio dentro de self-service,",
      "(5) registro de pipelines en Azure DevOps para las ramas develop, QA, staging y main.",
      "Devuelve un diagnóstico completo y una recomendación en lenguaje natural sobre la siguiente acción a ejecutar.",
      "No realiza cambios — solo diagnostica.",
      "PAT requerido: Code (Read) y Build (Read).",
    ].join(" "),
    inputSchema: {
      project: z.string().describe("Nombre exacto del proyecto de Azure DevOps donde vive el repositorio a validar."),
      repo_name: z.string().describe("Nombre del repositorio a validar en kebab-case."),
      organization: z.string().optional().describe(`Nombre de la organización en Azure DevOps. Si se omite, se usa '${getDefaultOrganization()}'.`),
      branches_to_check: z
        .array(z.string())
        .optional()
        .describe("Ramas a verificar para el registro de pipelines. Default: ['develop', 'QA', 'staging', 'main']."),
    },
    handler: async ({
      pat,
      project,
      repo_name,
      organization,
      branches_to_check,
    }: {
      pat: string; // inyectado desde el header mcp-pat
      project: string;
      repo_name: string;
      organization?: string;
      branches_to_check?: string[];
    }) => {
      ensureKebabCase(repo_name, "repositorio");
      const result = await validatePipelineStandardizationUseCase.execute({
        connection: buildConnection(organization, project, pat),
        repoName: repo_name,
        branchesToCheck: branches_to_check,
      });
      return ok(result);
    },
  },
];
