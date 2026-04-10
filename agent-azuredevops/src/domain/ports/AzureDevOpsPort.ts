import type { AzureConnection, PipelineInfo, RepoInfo } from "../types.js";

export interface PushFileResult {
  mode: "direct" | "pr";
  branch: string;
  auxBranch?: string;
  commitId: string;
  prId?: number;
  prUrl?: string;
  warning?: string;
}

export interface PullRequestResult {
  pullRequestId: number;
  url: string;
}

export interface ListProjectsResult {
  projects: {
    url: string;
    name: string;
    repos: {
      name: string;
      url: string;
    }[];
  }[];
}

export interface AzureDevOpsPort {
  validatePat(
    organization: string,
    pat: string,
  ): Promise<{ organization: string; visibleProjects?: number }>;
  getRepository(
    connection: AzureConnection,
    repoName: string,
  ): Promise<RepoInfo | null>;
  ensureRepository(
    connection: AzureConnection,
    repoName: string,
  ): Promise<{ isNew: boolean; repo: RepoInfo }>;
  fileExists(
    connection: AzureConnection,
    repoName: string,
    branch: string,
    filePath: string,
  ): Promise<boolean>;
  pushFile(
    connection: AzureConnection,
    repoName: string,
    branch: string,
    filePath: string,
    content: string,
    commitMessage: string,
    repoIsNew?: boolean,
  ): Promise<PushFileResult>;
  createBranch(
    connection: AzureConnection,
    repoName: string,
    sourceBranch: string,
    newBranch: string,
  ): Promise<{ branch: string; sourceBranch: string; objectId: string }>;
  createPullRequest(
    connection: AzureConnection,
    repoName: string,
    sourceBranch: string,
    targetBranch: string,
    title: string,
    description?: string,
  ): Promise<PullRequestResult>;
  registerPipeline(
    connection: AzureConnection,
    repoName: string,
    branch: string,
    yamlPath?: string,
    pipelineName?: string,
    pipelineFolder?: string,
  ): Promise<PipelineInfo & { yamlPath: string; repoName: string }>;
  listRepos(connection: AzureConnection): Promise<ListProjectsResult | null>;
}
