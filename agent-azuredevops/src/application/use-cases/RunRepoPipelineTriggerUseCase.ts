import type { AzureConnection } from "../../domain/types.js";
import type { AzureDevOpsPort } from "../../domain/ports/AzureDevOpsPort.js";
import { PipelineYamlGenerator } from "../../domain/services/PipelineYamlGenerator.js";

const BRANCHES = ["develop", "QA", "staging", "main"] as const;

export class RunRepoPipelineTriggerUseCase {
  constructor(
    private readonly azureDevOps: AzureDevOpsPort,
    private readonly pipelineYamlGenerator: PipelineYamlGenerator = new PipelineYamlGenerator(),
  ) {}

  async execute(connection: AzureConnection, repoName: string) {
    await this.azureDevOps.validatePat(connection.organization, connection.pat);

    const repo = await this.azureDevOps.getRepository(connection, repoName);
    if (!repo) {
      throw new Error(`El repositorio '${repoName}' no existe en '${connection.project}'.`);
    }

    const missingYamlBranches: string[] = [];
    for (const branch of BRANCHES) {
      const expectedYaml = `/${this.pipelineYamlGenerator.deriveMetadata(repoName, branch).pipelineRelativePath}`;
      const exists = await this.azureDevOps.fileExists(connection, repoName, branch, expectedYaml);
      if (!exists) {
        missingYamlBranches.push(`${branch}: ${expectedYaml}`);
      }
    }

    if (missingYamlBranches.length > 0) {
      throw new Error(
        [
          `Faltan archivos YAML requeridos para registrar pipelines en '${repoName}'.`,
          ...missingYamlBranches.map((item) => `- ${item}`),
        ].join("\n"),
      );
    }

    const pipelines = [];
    for (const branch of BRANCHES) {
      pipelines.push(await this.azureDevOps.registerPipeline(connection, repoName, branch));
    }

    return {
      organization: connection.organization,
      project: connection.project,
      repository: repo.name,
      pipelines,
    };
  }
}
