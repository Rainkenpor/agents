import type { AzureConnection } from "../../domain/types.js";
import type { AzureDevOpsPort } from "../../domain/ports/AzureDevOpsPort.js";
import { PipelineYamlGenerator, type PipelineYamlInput } from "../../domain/services/PipelineYamlGenerator.js";

export interface RunRepoPipelinePlusUseCaseInput extends PipelineYamlInput {
  connection: AzureConnection;
}

export class RunRepoPipelinePlusUseCase {
  constructor(
    private readonly azureDevOps: AzureDevOpsPort,
    private readonly pipelineYamlGenerator: PipelineYamlGenerator = new PipelineYamlGenerator(),
  ) {}

  async execute(input: RunRepoPipelinePlusUseCaseInput) {
    await this.azureDevOps.validatePat(input.connection.organization, input.connection.pat);

    const repo = await this.azureDevOps.getRepository(input.connection, input.repositorio);
    if (!repo) {
      throw new Error(`El repositorio '${input.repositorio}' no existe en '${input.connection.project}'.`);
    }

    const generated = this.pipelineYamlGenerator.generate({
      ambiente: input.ambiente,
      tecnologia: input.tecnologia,
      repositorio: input.repositorio,
      rama: input.rama,
      sonarKey: input.sonarKey,
      sonarName: input.sonarName,
      csproj: input.csproj,
    });

    await this.azureDevOps.createBranch(input.connection, input.repositorio, input.rama, generated.workingBranch);

    const pipelineAlreadyExists = await this.azureDevOps.fileExists(
      input.connection,
      input.repositorio,
      generated.workingBranch,
      `/${generated.pipelineRelativePath}`,
    );

    const push = await this.azureDevOps.pushFile(
      input.connection,
      input.repositorio,
      generated.workingBranch,
      `/${generated.pipelineRelativePath}`,
      generated.yaml,
      "ci: add CI/CD pipeline configuration",
      true,
    );

    const pullRequest = pipelineAlreadyExists
      ? undefined
      : await this.azureDevOps.createPullRequest(
          input.connection,
          input.repositorio,
          generated.workingBranch,
          input.rama,
          `ci: add CI/CD pipeline for ${input.repositorio}`,
          [
            "Pipeline CI/CD generado automaticamente por Agent Azure DevOps MCP.",
            "",
            `- Rama origen: ${generated.workingBranch}`,
            `- Rama destino: ${input.rama}`,
            `- Archivo: ${generated.pipelineRelativePath}`,
          ].join("\n"),
        );

    return {
      organization: input.connection.organization,
      project: input.connection.project,
      repository: repo.name,
      branch: input.rama,
      workingBranch: generated.workingBranch,
      pipelineRelativePath: generated.pipelineRelativePath,
      pipelineAlreadyExists,
      push,
      pullRequest,
    };
  }
}
