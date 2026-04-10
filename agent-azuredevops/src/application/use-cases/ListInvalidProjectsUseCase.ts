import type { AzureConnection } from "../../domain/types.js";
import type {
  AzureDevOpsPort,
  ListProjectsResult,
} from "../../domain/ports/AzureDevOpsPort.js";

export interface ListInvalidProjectsUseCaseInput {
  connection: AzureConnection;
}

const VALID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class ListInvalidProjectsUseCase {
  constructor(private readonly azureDevOps: AzureDevOpsPort) {}

  async execute(input: ListInvalidProjectsUseCaseInput) {
    await this.azureDevOps.validatePat(
      input.connection.organization,
      input.connection.pat,
    );

    const projects = await this.azureDevOps.listRepos(
      input.connection,
    );
    if (!projects) {
      throw new Error(
        `No se logró obtener de repositorios y projectos para la organización: '${input.connection.organization}'.`,
      );
    }

    const projectsWithIncorrectNaming = projects.projects
      .map((project) => ({
        ...project,
        correctName: VALID_PATTERN.test(project.name),
        repos: project.repos
          .map((repo) => ({
            ...repo,
            correctName: VALID_PATTERN.test(repo.name),
          }))
          .filter((repo) => !repo.correctName),
      }))
      .filter((project) => project.repos.length > 0);

    return {
      organization: input.connection.organization,
      projectsWithIncorrectNaming,
    };
  }
}