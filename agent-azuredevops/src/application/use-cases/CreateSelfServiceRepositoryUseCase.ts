import type { AzureConnection } from "../../domain/types.js";
import type { AzureDevOpsPort } from "../../domain/ports/AzureDevOpsPort.js";
import { HelmValuesGenerator } from "../../domain/services/HelmValuesGenerator.js";

const BRANCHES = ["develop", "QA", "staging", "main"] as const;

export interface CreateSelfServiceRepositoryUseCaseInput {
  connection: AzureConnection;
  repoName: string;
  imageProject: string;
  replicaCount: number;
  hasService: boolean;
  servicePort: number;
  hasIngress: boolean;
  hosting?: "On-Premise" | "AWS";
  webHost?: string;
  albName?: string;
  targetRepo: string;
}

export class CreateSelfServiceRepositoryUseCase {
  constructor(
    private readonly azureDevOps: AzureDevOpsPort,
    private readonly helmValuesGenerator: HelmValuesGenerator = new HelmValuesGenerator(),
  ) {}

  async execute(input: CreateSelfServiceRepositoryUseCaseInput) {
    await this.azureDevOps.validatePat(input.connection.organization, input.connection.pat);

    const appRepo = await this.azureDevOps.getRepository(input.connection, input.repoName);
    if (!appRepo) {
      throw new Error(`El repositorio de componente '${input.repoName}' no existe en '${input.connection.project}'.`);
    }

    const selfService = await this.azureDevOps.ensureRepository(input.connection, input.targetRepo);
    const branches = [];

    for (const branch of BRANCHES) {
      const yaml = this.helmValuesGenerator.generate({
        appRepoName: input.repoName,
        imageProject: input.imageProject,
        replicaCount: input.replicaCount,
        hasService: input.hasService,
        servicePort: input.servicePort,
        hasIngress: input.hasIngress,
        hosting: input.hosting,
        webHost: input.webHost,
        albName: input.albName,
        branch,
      });

      branches.push(await this.azureDevOps.pushFile(
        input.connection,
        input.targetRepo,
        branch,
        `/${input.repoName}/helm/values.yaml`,
        yaml.yaml,
        `feat: add helm values for ${input.repoName} (${branch})`,
        selfService.isNew,
      ));
    }

    return {
      organization: input.connection.organization,
      project: input.connection.project,
      sourceRepository: appRepo.name,
      targetRepository: selfService.repo.name,
      targetRepositoryIsNew: selfService.isNew,
      branches,
    };
  }
}
