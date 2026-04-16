import type { AzureConnection } from "../../domain/types.js";
import { encodeSegment, httpsGetOrNull } from "../../shared/http.js";
import { createAzureContext } from "../../infrastructure/azuredevops/client.js";
import { logger } from "../../util/logger.js";

// Required top-level keys that a valid CI/CD pipeline YAML must have
const REQUIRED_YAML_KEYS = ["trigger", "stages"] as const;
const MAX_YAML_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// ─── Output types ─────────────────────────────────────────────────────────────

export interface ValidationResult<T = string> {
  passed: boolean;
  details: T;
  error?: string;
}

export interface PipelineBranchDetail {
  found: boolean;
  pipeline_name: string | null;
}

export interface PipelinesByBranchDetails {
  [branch: string]: PipelineBranchDetail;
}

export interface PipelinesBranchValidation {
  passed: boolean;
  details: PipelinesByBranchDetails;
  missing_branches: string[];
  error?: string;
}

export interface YamlStructureIssue {
  file: string;
  missing_keys: string[];
}

export interface StandardizationValidations {
  yaml_files_in_pipelines_folder: ValidationResult<string[]>;
  yaml_structure_valid: ValidationResult<YamlStructureIssue[]>;
  self_service_repo_exists: ValidationResult<string>;
  helm_folder_for_repo_exists: ValidationResult<string>;
  pipelines_registered_by_branch: PipelinesBranchValidation;
}

export interface ValidatePipelineStandardizationResult {
  status: "complete" | "incomplete" | "partial";
  project: string;
  repository: string;
  validations: StandardizationValidations;
  next_action_recommendation: string;
  manual_action_required: boolean;
  manual_action_comment: string | null;
}

export interface ValidatePipelineStandardizationInput {
  connection: AzureConnection;
  repoName: string;
  branchesToCheck?: string[];
}

// ─── Self-service repo name candidates ───────────────────────────────────────
const SELF_SERVICE_CANDIDATES = [
  "self-service-devops",
  "self-service",
  "self_service",
  "self_service_devops",
];

// ─── Individual checks ────────────────────────────────────────────────────────

async function checkYamlFilesInPipelinesFolder(
  connection: AzureConnection,
  repoName: string,
): Promise<{ result: ValidationResult<string[]>; yamlPaths: string[] }> {
  const ctx = createAzureContext(connection);
  try {
    // scopePath lists folder contents without the 400 caused by path+recursionLevel
    const items = await httpsGetOrNull<{
      value?: Array<{ path: string; gitObjectType?: string }>;
    }>({
      hostname: "dev.azure.com",
      path: `${ctx.repositoriesPath}/${encodeSegment(repoName)}/items?scopePath=/pipelines&recursionLevel=OneLevel&api-version=7.1`,
      method: "GET",
      headers: ctx.headers,
    });

    if (!items?.value || items.value.length === 0) {
      return { result: { passed: false, details: [], error: "Carpeta /pipelines no encontrada o vacía" }, yamlPaths: [] };
    }

    const yamlItems = items.value.filter(
      (item) => item.gitObjectType !== "tree" && /\.(yaml|yml)$/i.test(item.path),
    );

    if (yamlItems.length === 0) {
      return {
        result: { passed: false, details: [], error: "La carpeta /pipelines existe pero no contiene archivos .yaml/.yml" },
        yamlPaths: [],
      };
    }

    const names = yamlItems.map((item) => item.path.split("/").pop() ?? item.path);
    return { result: { passed: true, details: names }, yamlPaths: yamlItems.map((i) => i.path) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { result: { passed: false, details: [], error }, yamlPaths: [] };
  }
}

async function checkYamlStructure(
  connection: AzureConnection,
  repoName: string,
  yamlPaths: string[],
): Promise<ValidationResult<YamlStructureIssue[]>> {
  if (yamlPaths.length === 0) {
    return { passed: false, details: [], error: "Sin archivos YAML para validar" };
  }

  const ctx = createAzureContext(connection);
  const issues: YamlStructureIssue[] = [];

  await Promise.all(
    yamlPaths.map(async (filePath) => {
      try {
        const response = await httpsGetOrNull<string>({
          hostname: "dev.azure.com",
          path: `${ctx.repositoriesPath}/${encodeSegment(repoName)}/items?path=${encodeURIComponent(filePath)}&api-version=7.1`,
          method: "GET",
          headers: { ...ctx.headers, Accept: "text/plain" },
        });

        const content = typeof response === "string" ? response : JSON.stringify(response ?? "");
        const sizeBytes = Buffer.byteLength(content, "utf-8");
        if (sizeBytes > MAX_YAML_SIZE_BYTES) {
          issues.push({ file: filePath.split("/").pop() ?? filePath, missing_keys: [`<archivo excede 5 MB (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)>`] });
          return;
        }
        const missing = REQUIRED_YAML_KEYS.filter((key) => !new RegExp(`^${key}:`, "m").test(content));

        if (missing.length > 0) {
          issues.push({ file: filePath.split("/").pop() ?? filePath, missing_keys: missing });
        }
      } catch {
        issues.push({ file: filePath.split("/").pop() ?? filePath, missing_keys: ["<error al leer el archivo>"] });
      }
    }),
  );

  return { passed: issues.length === 0, details: issues };
}

async function checkSelfServiceRepoExists(
  connection: AzureConnection,
): Promise<{ passed: boolean; repoName: string | null; details: string; error?: string }> {
  const ctx = createAzureContext(connection);
  for (const candidate of SELF_SERVICE_CANDIDATES) {
    try {
      const repo = await httpsGetOrNull<{ id: string; name: string }>({
        hostname: "dev.azure.com",
        path: `${ctx.repositoriesPath}/${encodeSegment(candidate)}?api-version=7.1`,
        method: "GET",
        headers: ctx.headers,
      });
      if (repo?.id) {
        return { passed: true, repoName: repo.name, details: `Repositorio encontrado: ${repo.name} (id: ${repo.id})` };
      }
    } catch {
      // 404 treated as not found, continue
    }
  }
  return { passed: false, repoName: null, details: "No se encontró el repositorio self-service en el proyecto" };
}

async function checkHelmFolderForRepo(
  connection: AzureConnection,
  selfServiceRepoName: string,
  targetRepo: string,
): Promise<ValidationResult<string>> {
  const ctx = createAzureContext(connection);
  try {
    const item = await httpsGetOrNull<unknown>({
      hostname: "dev.azure.com",
      path: `${ctx.repositoriesPath}/${encodeSegment(selfServiceRepoName)}/items?path=/${encodeURIComponent(targetRepo)}&api-version=7.1`,
      method: "GET",
      headers: ctx.headers,
    });

    if (item) {
      return { passed: true, details: `Carpeta /${targetRepo} encontrada en ${selfServiceRepoName}` };
    }
    return { passed: false, details: `No se encontró la carpeta /${targetRepo} dentro de ${selfServiceRepoName}` };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { passed: false, details: `No se encontró la carpeta /${targetRepo} dentro de ${selfServiceRepoName}`, error };
  }
}

async function checkPipelinesRegisteredByBranch(
  connection: AzureConnection,
  repoName: string,
  branches: string[],
): Promise<PipelinesBranchValidation> {
  const ctx = createAzureContext(connection);
  try {
    const response = await httpsGetOrNull<{
      value?: Array<{
        id: number;
        name: string;
        configuration?: { repository?: { id: string } };
      }>;
    }>({
      hostname: "dev.azure.com",
      path: `${ctx.pipelinesPath}?api-version=7.1`,
      method: "GET",
      headers: ctx.headers,
    });

    // Fetch repo id to match pipelines
    const repoInfo = await httpsGetOrNull<{ id: string; name: string }>({
      hostname: "dev.azure.com",
      path: `${ctx.repositoriesPath}/${encodeSegment(repoName)}?api-version=7.1`,
      method: "GET",
      headers: ctx.headers,
    });

    const pipelines = response?.value ?? [];

    // Pipeline names follow pattern: {prefix}-cicd-{repoName}
    // We match by name since configuration.repository may not always be present at list level
    const branchPrefixMap: Record<string, string> = {
      develop: "dev",
      QA: "qa",
      staging: "stg",
      main: "main",
    };

    const byBranch: PipelinesByBranchDetails = {};
    const missingBranches: string[] = [];

    for (const branch of branches) {
      const prefix = branchPrefixMap[branch] ?? branch.toLowerCase();
      const expectedName = `${prefix}-cicd-${repoName}`.toLowerCase();
      const match = pipelines.find(
        (p) =>
          p.name.toLowerCase() === expectedName ||
          (repoInfo?.id && p.configuration?.repository?.id === repoInfo.id && p.name.toLowerCase().includes(prefix)),
      );
      byBranch[branch] = { found: !!match, pipeline_name: match?.name ?? null };
      if (!match) missingBranches.push(branch);
    }

    return {
      passed: missingBranches.length === 0,
      details: byBranch,
      missing_branches: missingBranches,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const byBranch = Object.fromEntries(
      branches.map((b) => [b, { found: false, pipeline_name: null }]),
    ) as PipelinesByBranchDetails;
    return { passed: false, details: byBranch, missing_branches: [...branches], error };
  }
}

// ─── Recommendation builder ───────────────────────────────────────────────────

function buildRecommendation(
  validations: StandardizationValidations,
): { recommendation: string; manualRequired: boolean } {
  const { yaml_files_in_pipelines_folder, yaml_structure_valid, self_service_repo_exists, helm_folder_for_repo_exists, pipelines_registered_by_branch } = validations;

  // Case G — all passed
  if (
    yaml_files_in_pipelines_folder.passed &&
    yaml_structure_valid.passed &&
    self_service_repo_exists.passed &&
    helm_folder_for_repo_exists.passed &&
    pipelines_registered_by_branch.passed
  ) {
    return { recommendation: "El flujo de estandarización está completo. No se requiere acción adicional.", manualRequired: false };
  }

  // Case A — no YAML
  if (!yaml_files_in_pipelines_folder.passed) {
    return {
      recommendation:
        "El repositorio no contiene los archivos YAML de pipeline estandarizado. Solicitar parámetros al usuario para ejecutar la herramienta que genera el YAML CI/CD y crea el Pull Request hacia la rama objetivo.",
      manualRequired: false,
    };
  }

  // Case A2 — YAML exists but structure is invalid
  if (!yaml_structure_valid.passed && yaml_structure_valid.details.length > 0) {
    const affected = yaml_structure_valid.details.map((i) => `${i.file} (falta: ${i.missing_keys.join(", ")})`).join("; ");
    return {
      recommendation: `Los archivos YAML existen pero tienen estructura inválida: ${affected}. Regenerar los YAML usando la herramienta correspondiente.`,
      manualRequired: false,
    };
  }

  // Case B — no self-service repo
  if (!self_service_repo_exists.passed) {
    return {
      recommendation:
        "El repositorio self_service no existe en el proyecto. Solicitar parámetros al usuario para ejecutar la herramienta que crea el repositorio self-service-devops con los valores Helm para las ramas estándar.",
      manualRequired: false,
    };
  }

  // Case C — no Helm folder
  if (!helm_folder_for_repo_exists.passed) {
    return {
      recommendation:
        "El repositorio self_service existe, pero no contiene la carpeta con los valores Helm del repositorio objetivo. Solicitar parámetros al usuario para ejecutar la herramienta que agrega los valores Helm al repositorio self-service.",
      manualRequired: false,
    };
  }

  // YAML OK, self-service OK, helm OK, pipelines fail
  const missing = pipelines_registered_by_branch.missing_branches;
  const allMissing = missing.length === Object.keys(pipelines_registered_by_branch.details).length;

  if (allMissing) {
    // Case D — no pipelines at all
    return {
      recommendation:
        "Los archivos YAML existen en el repositorio, pero los pipelines no están registrados en Azure DevOps. Solicitar parámetros al usuario para ejecutar la herramienta que registra los pipelines estándar cuando los YAML ya existen.",
      manualRequired: false,
    };
  }

  // Case E — partial pipelines
  return {
    recommendation: `Los pipelines existen pero falta el registro para las ramas: ${missing.join(", ")}. Solicitar parámetros para registrar los pipelines faltantes en dichas ramas.`,
    manualRequired: false,
  };
}

function computeStatus(validations: StandardizationValidations): "complete" | "incomplete" | "partial" {
  const all = [
    validations.yaml_files_in_pipelines_folder.passed,
    validations.yaml_structure_valid.passed,
    validations.self_service_repo_exists.passed,
    validations.helm_folder_for_repo_exists.passed,
    validations.pipelines_registered_by_branch.passed,
  ];
  const passedCount = all.filter(Boolean).length;
  if (passedCount === all.length) return "complete";
  if (passedCount === 0) return "incomplete";
  return "partial";
}

// ─── Use Case ─────────────────────────────────────────────────────────────────

export class ValidatePipelineStandardizationUseCase {
  async execute(input: ValidatePipelineStandardizationInput): Promise<ValidatePipelineStandardizationResult> {
    const { connection, repoName, branchesToCheck = ["develop", "QA", "staging", "main"] } = input;

    logger.info(`[ValidatePipelineStandardization] project=${connection.project} repo=${repoName}`);

    // Validations 1, 2, 4 are independent — run in parallel
    const [yamlCheckRaw, selfServiceCheck, pipelinesCheck] = await Promise.all([
      checkYamlFilesInPipelinesFolder(connection, repoName),
      checkSelfServiceRepoExists(connection),
      checkPipelinesRegisteredByBranch(connection, repoName, branchesToCheck),
    ]);

    const yamlCheck = yamlCheckRaw.result;

    // YAML structure check depends on knowing which files exist
    const structureCheck = await checkYamlStructure(connection, repoName, yamlCheckRaw.yamlPaths);

    logger.info(`[ValidatePipelineStandardization] yaml=${yamlCheck.passed} structure=${structureCheck.passed} selfService=${selfServiceCheck.passed} pipelines=${pipelinesCheck.passed}`);

    // Validation 3 depends on validation 2
    let helmCheck: ValidationResult<string>;
    if (selfServiceCheck.passed && selfServiceCheck.repoName) {
      helmCheck = await checkHelmFolderForRepo(connection, selfServiceCheck.repoName, repoName);
    } else {
      helmCheck = { passed: false, details: "Omitido: el repositorio self-service no existe" };
    }

    logger.info(`[ValidatePipelineStandardization] helm=${helmCheck.passed}`);

    const validations: StandardizationValidations = {
      yaml_files_in_pipelines_folder: yamlCheck,
      yaml_structure_valid: structureCheck,
      self_service_repo_exists: { passed: selfServiceCheck.passed, details: selfServiceCheck.details, error: selfServiceCheck.error },
      helm_folder_for_repo_exists: helmCheck,
      pipelines_registered_by_branch: pipelinesCheck,
    };

    const { recommendation, manualRequired } = buildRecommendation(validations);
    const status = computeStatus(validations);

    return {
      status,
      project: connection.project,
      repository: repoName,
      validations,
      next_action_recommendation: recommendation,
      manual_action_required: manualRequired,
      manual_action_comment: manualRequired
        ? "Se debe levantar un ticket al equipo de Azure DevOps para finalizar la estandarización de los pipelines."
        : null,
    };
  }
}
