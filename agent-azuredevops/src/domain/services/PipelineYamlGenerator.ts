const CI_TEMPLATES: Record<string, Record<string, string | null>> = {
  onpremise: {
    nodejs: "onpremise/hermes/nodejs/ci/ci.yaml@plantillas",
    vite: "onpremise/hermes/vite/ci/ci.yaml@plantillas",
    netcore: "onpremise/hermes/netcore/ci/ci.yaml@plantillas",
    react: "onpremise/hermes/react/ci/ci.yaml@plantillas",
    netframework: null,
    angular: null,
    python: null,
    flutter: null,
  },
  cloud: {
    nodejs: "cloud/aws/eks/nodejs/ci/ci.yaml@plantillas",
    vite: "cloud/aws/eks/vite/ci/ci.yaml@plantillas",
    netcore: "cloud/aws/eks/netcore/ci/ci.yaml@plantillas",
    react: "cloud/aws/eks/react/ci/ci.yaml@plantillas",
    netframework: null,
    angular: null,
    python: null,
    flutter: null,
  },
};

const BRANCH_PREFIX: Record<string, string> = {
  develop: "dev",
  QA: "qa",
  staging: "stg",
  main: "main",
};

const AZ = (expr: string) => `\${{ ${expr} }}`;

export interface PipelineYamlInput {
  ambiente: "onpremise" | "cloud";
  tecnologia: "nodejs" | "netcore" | "vite" | "react" | "angular" | "netframework" | "python" | "flutter";
  repositorio: string;
  rama: "develop" | "QA" | "staging" | "main";
  sonarKey: string;
  sonarName: string;
  csproj?: string;
}

export function hasPipelineTemplate(
  ambiente: PipelineYamlInput["ambiente"],
  tecnologia: PipelineYamlInput["tecnologia"],
): boolean {
  return Boolean(CI_TEMPLATES[ambiente]?.[tecnologia]);
}

export class PipelineYamlGenerator {
  deriveMetadata(repoName: string, branch: PipelineYamlInput["rama"]) {
    const prefijo = BRANCH_PREFIX[branch] ?? branch;
    return {
      prefijo,
      pipelineRelativePath: `pipelines/${prefijo}-cicd-${repoName}.yaml`,
      workingBranch: `${branch}-pipeline-create`,
    };
  }

  generate(input: PipelineYamlInput): { yaml: string; pipelineRelativePath: string; workingBranch: string } {
    const ciTemplate = CI_TEMPLATES[input.ambiente]?.[input.tecnologia] ?? null;
    const meta = this.deriveMetadata(input.repositorio, input.rama);
    const isNetcore = input.tecnologia === "netcore";
    const isCloud = input.ambiente === "cloud";

    if (!ciTemplate) {
      return {
        yaml: [
          "# Sin plantilla CI disponible",
          `# Combinacion: ${input.ambiente} + ${input.tecnologia}`,
          "# Contacta al area de DevOps para mas informacion.",
          `# Archivo destino: ${meta.pipelineRelativePath}`,
        ].join("\n"),
        pipelineRelativePath: meta.pipelineRelativePath,
        workingBranch: meta.workingBranch,
      };
    }

    const variables = [
      "- name: sonarQubeProjectKey",
      `  value: \"${input.sonarKey}\"`,
      "- name: sonarQubeProjectName",
      `  value: \"${input.sonarName}\"`,
      ...(isNetcore ? ["- name: pathCsprojPublicacion", `  value: \"${input.csproj ?? ""}\"`] : []),
      "- name: repositorioK8s",
      '  value: "$(System.CollectionUri)$(System.TeamProject)/_git/self-service-devops"',
      "- name: ramaK8s",
      "  value: $(Build.SourceBranchName)",
      "- name: repositorioOrigen",
      "  value: $(Build.Repository.Name)",
      "- group: self-service-devops",
      "- group: azure-devops-access",
      isCloud ? "- group: login-aws" : "# - group: login-aws  # Descomentar si el ambiente es cloud",
    ].join("\n");

    const ciParams = [
      `    sonarQubeProjectKey: ${AZ("variables.sonarQubeProjectKey")}`,
      `    sonarQubeProjectName: ${AZ("variables.sonarQubeProjectName")}`,
      ...(isNetcore ? [`    pathCsprojPublicacion: ${AZ("variables.pathCsprojPublicacion")}`] : []),
    ].join("\n");

    return {
      pipelineRelativePath: meta.pipelineRelativePath,
      workingBranch: meta.workingBranch,
      yaml: [
        "# Pipeline generado por Agent Azure DevOps MCP",
        `# Archivo: ${meta.pipelineRelativePath}`,
        "",
        "resources:",
        "  repositories:",
        "  - repository: plantillas",
        "    type: git",
        "    name: self-service-devops/cicd-blueprints",
        `    ref: refs/heads/${input.rama}`,
        "",
        "trigger:",
        "  branches:",
        "    include:",
        `    - ${input.rama}`,
        "  paths:",
        "    exclude:",
        "    - pipelines/*",
        "",
        "variables:",
        variables,
        "",
        "stages:",
        "# 1. Integracion Continua",
        `- template: ${ciTemplate}`,
        "  parameters:",
        ciParams,
        "",
        "# 2. Despliegue Continuo (GitOps / K8s)",
        "- template: common/cd/cd.yaml@plantillas",
        "  parameters:",
        `    repositorioK8s: ${AZ("variables.repositorioK8s")}`,
        `    ramaK8s: ${AZ("variables.ramaK8s")}`,
        `    repositorioOrigen: ${AZ("variables.repositorioOrigen")}`,
        "",
        "# Requisitos previos:",
        "# 1. SonarQube: solicitar ProjectKey al area de QA",
        "# 2. Repo k8s: configurar self-service-devops segun guia de Valores de Despliegue",
        `# 3. Variable Groups: self-service-devops, azure-devops-access${isCloud ? ", login-aws" : ""}`,
      ].join("\n"),
    };
  }
}
