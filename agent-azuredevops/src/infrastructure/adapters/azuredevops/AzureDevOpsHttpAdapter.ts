import type { AzureConnection } from "../../../domain/types.js";
import type { AzureDevOpsPort } from "../../../domain/ports/AzureDevOpsPort.js";
import { createBranch, createPullRequest, ensureRepository, fileExists, getRepository, pushFile, validatePat } from "../../azuredevops/repositories.js";
import { registerPipeline } from "../../azuredevops/pipelines.js";

export class AzureDevOpsHttpAdapter implements AzureDevOpsPort {
  validatePat(organization: string, pat: string) {
    return validatePat(organization, pat);
  }

  getRepository(connection: AzureConnection, repoName: string) {
    return getRepository(connection, repoName);
  }

  ensureRepository(connection: AzureConnection, repoName: string) {
    return ensureRepository(connection, repoName);
  }

  fileExists(connection: AzureConnection, repoName: string, branch: string, filePath: string) {
    return fileExists(connection, repoName, branch, filePath);
  }

  pushFile(connection: AzureConnection, repoName: string, branch: string, filePath: string, content: string, commitMessage: string, repoIsNew = false) {
    return pushFile(connection, repoName, branch, filePath, content, commitMessage, repoIsNew);
  }

  createBranch(connection: AzureConnection, repoName: string, sourceBranch: string, newBranch: string) {
    return createBranch(connection, repoName, sourceBranch, newBranch);
  }

  createPullRequest(connection: AzureConnection, repoName: string, sourceBranch: string, targetBranch: string, title: string, description?: string) {
    return createPullRequest(connection, repoName, sourceBranch, targetBranch, title, description);
  }

  registerPipeline(connection: AzureConnection, repoName: string, branch: string, yamlPath?: string, pipelineName?: string, pipelineFolder?: string) {
    return registerPipeline(connection, repoName, branch, yamlPath, pipelineName, pipelineFolder);
  }
}
