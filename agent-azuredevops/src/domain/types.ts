export interface AzureConnection {
  organization: string;
  project: string;
  pat: string;
}

export interface RepoInfo {
  id: string;
  name: string;
  webUrl: string;
  remoteUrl?: string;
}

export interface PipelineInfo {
  pipelineId: number;
  pipelineName: string;
  url: string;
  status: "created" | "already_exists";
}

export interface HelmValuesInput {
  appRepoName: string;
  imageProject: string;
  replicaCount: number;
  hasService: boolean;
  servicePort: number;
  hasIngress: boolean;
  hosting?: "On-Premise" | "AWS";
  webHost?: string;
  albName?: string;
  branch: string;
}
