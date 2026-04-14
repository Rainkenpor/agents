import type { AzureConnection } from "../../domain/types.js";
import type { AzureDevOpsPort } from "../../domain/ports/AzureDevOpsPort.js";
import { hasPipelineTemplate, PipelineYamlGenerator, type PipelineYamlInput } from "../../domain/services/PipelineYamlGenerator.js";

export interface CreatePipelineYamlUseCaseInput extends PipelineYamlInput {
  connection: AzureConnection;
}

export class CreatePipelineYamlUseCase {
  constructor(
    private readonly azureDevOps: AzureDevOpsPort,
    private readonly pipelineYamlGenerator: PipelineYamlGenerator = new PipelineYamlGenerator(),
  ) {}

  async execute(input: CreatePipelineYamlUseCaseInput) {
    await this.azureDevOps.validatePat(input.connection.organization, input.connection.pat);

    if (!hasPipelineTemplate(input.ambiente, input.tecnologia)) {
      throw new Error(
        `La combinacion '${input.ambiente}/${input.tecnologia}' aun no tiene plantilla CI/CD soportada por este servidor MCP.`,
      );
    }

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

    // Verificar antes de crear la rama de trabajo para mantener la operacion idempotente:
    // si el archivo ya existe en la rama destino, no hay nada que subir ni mergear.
    const pipelineAlreadyExists = await this.azureDevOps.fileExists(
      input.connection,
      input.repositorio,
      input.rama,
      `/${generated.pipelineRelativePath}`,
    );

    if (pipelineAlreadyExists) {
      return {
        organization: input.connection.organization,
        project: input.connection.project,
        repository: repo.name,
        branch: input.rama,
        workingBranch: generated.workingBranch,
        pipelineRelativePath: generated.pipelineRelativePath,
        pipelineAlreadyExists,
        push: null,
        pullRequest: null,
      };
    }

    await this.azureDevOps.createBranch(input.connection, input.repositorio, input.rama, generated.workingBranch);

    const push = await this.azureDevOps.pushFile(
      input.connection,
      input.repositorio,
      generated.workingBranch,
      `/${generated.pipelineRelativePath}`,
      generated.yaml,
      "ci: add CI/CD pipeline configuration",
      true,
    );

    const pullRequest = await this.azureDevOps.createPullRequest(
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
