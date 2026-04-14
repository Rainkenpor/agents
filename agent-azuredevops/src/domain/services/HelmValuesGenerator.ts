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
    const serviceEnabled = input.hasService ? "true" : "false";
    const ingressEnabled = input.hasIngress ? "true" : "false";
    const ingressClassName = input.hosting === "AWS" ? "alb" : "nginx";
    const hostLine = input.webHost ? `    - host: ${input.webHost}` : "    - host: example.local";
    const pathsBlock = [
      "      http:",
      "        paths:",
      "          - path: /",
      "            pathType: Prefix",
      "            backend:",
      "              service:",
      `                name: ${input.appRepoName}`,
      "                port:",
      `                  number: ${input.servicePort}`,
    ].join("\n");
    const awsAnnotations = input.hosting === "AWS"
      ? [
          "  annotations:",
          `    alb.ingress.kubernetes.io/group.name: ${input.albName ?? "shared-alb"}`,
          "    alb.ingress.kubernetes.io/scheme: internal",
          "    alb.ingress.kubernetes.io/target-type: ip",
        ].join("\n")
      : "";

    return [
      `replicaCount: ${input.replicaCount}`,
      "",
      "image:",
      `  repository: ${input.imageProject}/${input.appRepoName}`,
      `  tag: ${input.branch}`,
      "  pullPolicy: IfNotPresent",
      "",
      "service:",
      `  enabled: ${serviceEnabled}`,
      `  port: ${input.servicePort}`,
      "",
      "ingress:",
      `  enabled: ${ingressEnabled}`,
      `  className: ${ingressClassName}`,
      ...(awsAnnotations ? [awsAnnotations] : []),
      "  hosts:",
      hostLine,
      pathsBlock,
      "",
      "resources: {}",
      "",
      "autoscaling:",
      "  enabled: false",
      "",
      "nodeSelector: {}",
      "",
      "tolerations: []",
      "",
      "affinity: {}",
    ].join("\n");
  }
}
