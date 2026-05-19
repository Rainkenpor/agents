import type { HelmValuesInput } from "../types.js";
import { ensureKebabCase } from "../../shared/validation.js";

export class HelmValuesGenerator {
  generate(input: HelmValuesInput): { appRepoName: string; branch: string; yaml: string } {
    ensureKebabCase(input.appRepoName, "repositorio");
    return {
      appRepoName: input.appRepoName,
      branch: input.branch,
      yaml: this.buildYaml(input),
    };
  }

  private buildYaml(input: HelmValuesInput): string {
    const ingressEnabled = input.hasIngress ? "true" : "false";
    const isAWS = input.hosting === "AWS" ? "true" : "false";
    const ingressClassName = input.hosting === "AWS" ? "alb" : "nginx";
    const ingressHost = input.webHost ?? "example.local";

    return [
      `replicaCount: ${input.replicaCount}`,
      `nombreDespliegue: ${input.appRepoName}`,
      `envFromSecret: "${input.appRepoName}-secret"`,
      `keyVaultSecret: "${input.imageProject}-${input.appRepoName}-secret"`,
      `keyVaultSecretBranch: "${input.branch}"`,
      "",
      "service:",
      `  port: ${input.servicePort}`,
      `  targetPort: ${input.servicePort}`,
      "  type: ClusterIP",
      "  protocol: TCP",
      "",
      "ingress:",
      `  enabled: ${ingressEnabled}`,
      `  isAWS: ${isAWS}`,
      `  className: "${ingressClassName}"`,
      `  host: "${ingressHost}"`,
      "  path: /",
      "  pathType: Prefix",
      "",
      "# __________________________________NO EDITAR ESTA SECCION________________________________________________________",
      "image:",
      `  repository: ${input.imageProject}/${input.appRepoName}`,
      `  tag: ${input.branch}`,
      "  pullPolicy: Always",
      "",
    ].join("\n");
  }
}
