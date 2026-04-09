import type { AzureConnection, RepoInfo } from "../../domain/types.js";
import { encodeSegment, httpsGetOrNull, httpsRequest } from "../../shared/http.js";
import { createAzureContext } from "./client.js";

type RefsResponse = { value: Array<{ name: string; objectId: string }> };
type PushResponse = { commits?: Array<{ commitId: string }> };
type RefUpdateResult = { value: Array<{ success: boolean; newObjectId: string }> };
type PullRequestResponse = { pullRequestId: number };

const EMPTY_OBJECT_ID = "0000000000000000000000000000000000000000";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function validatePat(organization: string, pat: string): Promise<{ organization: string; visibleProjects?: number }> {
  const headers = createAzureContext({ organization, project: "_", pat }).headers;
  const response = await httpsRequest<{ count?: number; value?: Array<{ name: string }> }>({
    hostname: "dev.azure.com",
    path: `/${encodeSegment(organization)}/_apis/projects?api-version=7.1&$top=1`,
    method: "GET",
    headers,
  });

  return {
    organization,
    visibleProjects: response.count ?? response.value?.length,
  };
}

export async function getRepository(connection: AzureConnection, repoName: string): Promise<RepoInfo | null> {
  const ctx = createAzureContext(connection);
  return httpsGetOrNull<RepoInfo>({
    hostname: "dev.azure.com",
    path: `${ctx.repositoriesPath}/${encodeSegment(repoName)}?api-version=7.1`,
    method: "GET",
    headers: ctx.headers,
  });
}

export async function waitForRepositoryReadiness(connection: AzureConnection, repoName: string, retries = 8, delayMs = 1500): Promise<RepoInfo> {
  const ctx = createAzureContext(connection);
  const encodedRepo = encodeSegment(repoName);
  let lastError = "repositorio no disponible";

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const repo = await httpsGetOrNull<RepoInfo>({
        hostname: "dev.azure.com",
        path: `${ctx.repositoriesPath}/${encodedRepo}?api-version=7.1`,
        method: "GET",
        headers: ctx.headers,
      });

      if (!repo) {
        lastError = `Repositorio '${repoName}' aun no visible`;
      } else {
        await httpsRequest<RefsResponse>({
          hostname: "dev.azure.com",
          path: `${ctx.repositoriesPath}/${encodedRepo}/refs?api-version=7.1`,
          method: "GET",
          headers: ctx.headers,
        });
        return repo;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < retries) {
      await sleep(delayMs);
    }
  }

  throw new Error(`El repositorio '${repoName}' existe pero Azure DevOps aun no lo deja listo para refs/pushes. Ultimo error: ${lastError}`);
}

export async function ensureRepository(connection: AzureConnection, repoName: string): Promise<{ isNew: boolean; repo: RepoInfo }> {
  const ctx = createAzureContext(connection);
  const existing = await getRepository(connection, repoName);
  if (existing) {
    const ready = await waitForRepositoryReadiness(connection, repoName);
    return { isNew: false, repo: ready };
  }

  const payload = JSON.stringify({ name: repoName });
  await httpsRequest<RepoInfo>({
    hostname: "dev.azure.com",
    path: `${ctx.repositoriesPath}?api-version=7.1`,
    method: "POST",
    headers: { ...ctx.headers, "Content-Length": String(Buffer.byteLength(payload)) },
  }, payload);

  const ready = await waitForRepositoryReadiness(connection, repoName);
  return { isNew: true, repo: ready };
}

export async function getRepositoryRefs(connection: AzureConnection, repoName: string): Promise<RefsResponse> {
  const ctx = createAzureContext(connection);
  return httpsRequest<RefsResponse>({
    hostname: "dev.azure.com",
    path: `${ctx.repositoriesPath}/${encodeSegment(repoName)}/refs?api-version=7.1`,
    method: "GET",
    headers: ctx.headers,
  });
}

export async function fileExists(connection: AzureConnection, repoName: string, branch: string, filePath: string): Promise<boolean> {
  const ctx = createAzureContext(connection);
  try {
    await httpsRequest<unknown>({
      hostname: "dev.azure.com",
      path: `${ctx.repositoriesPath}/${encodeSegment(repoName)}/items?path=${encodeURIComponent(filePath)}&versionDescriptor.version=${encodeURIComponent(branch)}&api-version=7.1`,
      method: "GET",
      headers: ctx.headers,
    });
    return true;
  } catch {
    return false;
  }
}

export async function pushFile(connection: AzureConnection, repoName: string, branch: string, filePath: string, content: string, commitMessage: string, repoIsNew = false): Promise<{ mode: "direct" | "pr"; branch: string; auxBranch?: string; commitId: string; prId?: number; prUrl?: string; warning?: string }> {
  await waitForRepositoryReadiness(connection, repoName);

  const ctx = createAzureContext(connection);
  const encodedRepo = encodeSegment(repoName);
  const encodedContent = Buffer.from(content, "utf-8").toString("base64");

  const getRefs = () => getRepositoryRefs(connection, repoName);

  const pushCommit = (refName: string, oldObjectId: string, changeType: "add" | "edit") =>
    httpsRequest<PushResponse>({
      hostname: "dev.azure.com",
      path: `${ctx.repositoriesPath}/${encodedRepo}/pushes?api-version=7.1`,
      method: "POST",
      headers: ctx.headers,
    }, JSON.stringify({
      refUpdates: [{ name: refName, oldObjectId }],
      commits: [{
        comment: commitMessage,
        changes: [{
          changeType,
          item: { path: filePath },
          newContent: { content: encodedContent, contentType: "base64Encoded" },
        }],
      }],
    }));

  const createRef = (name: string, fromObjectId: string) =>
    httpsRequest<RefUpdateResult>({
      hostname: "dev.azure.com",
      path: `${ctx.repositoriesPath}/${encodedRepo}/refs?api-version=7.1`,
      method: "POST",
      headers: ctx.headers,
    }, JSON.stringify([{ name, newObjectId: fromObjectId, oldObjectId: EMPTY_OBJECT_ID }]));

  const refs = await getRefs();
  const isEmptyRepo = !refs.value || refs.value.length === 0;
  if (isEmptyRepo) {
    const push = await pushCommit(`refs/heads/${branch}`, EMPTY_OBJECT_ID, "add");
    return { mode: "direct", branch, commitId: push.commits?.[0]?.commitId ?? "desconocido" };
  }

  const branchRef = refs.value.find((ref) => ref.name === `refs/heads/${branch}`);
  if (!branchRef) {
    const sourceRef = refs.value.find((ref) => ref.name === "refs/heads/develop") ?? refs.value[0];
    if (!sourceRef) throw new Error(`No se encontro una rama base para crear '${branch}'.`);

    const created = await createRef(`refs/heads/${branch}`, sourceRef.objectId);
    if (!created.value?.[0]?.success) throw new Error(`No se pudo crear la rama '${branch}'.`);

    const refreshed = await getRefs();
    const newRef = refreshed.value.find((ref) => ref.name === `refs/heads/${branch}`);
    if (!newRef) throw new Error(`Rama '${branch}' creada pero no encontrada al refrescar.`);

    const changeType = await fileExists(connection, repoName, branch, filePath) ? "edit" : "add";
    const push = await pushCommit(`refs/heads/${branch}`, newRef.objectId, changeType);
    return { mode: "direct", branch, commitId: push.commits?.[0]?.commitId ?? "desconocido" };
  }

  if (repoIsNew) {
    const changeType = await fileExists(connection, repoName, branch, filePath) ? "edit" : "add";
    const push = await pushCommit(`refs/heads/${branch}`, branchRef.objectId, changeType);
    return { mode: "direct", branch, commitId: push.commits?.[0]?.commitId ?? "desconocido" };
  }

  const auxBranch = `${branch}-pipeline`;
  const auxRefName = `refs/heads/${auxBranch}`;
  const existingAux = refs.value.find((ref) => ref.name === auxRefName);
  let auxObjectId = existingAux?.objectId;

  if (!auxObjectId) {
    const created = await createRef(auxRefName, branchRef.objectId);
    if (!created.value?.[0]?.success) throw new Error(`No se pudo crear la rama auxiliar '${auxBranch}'.`);

    const refreshed = await getRefs();
    auxObjectId = refreshed.value.find((ref) => ref.name === auxRefName)?.objectId;
    if (!auxObjectId) throw new Error(`Rama auxiliar '${auxBranch}' no encontrada tras crearla.`);
  }

  const changeType = await fileExists(connection, repoName, auxBranch, filePath) ? "edit" : "add";
  const push = await pushCommit(auxRefName, auxObjectId, changeType);

  try {
    const pr = await httpsRequest<PullRequestResponse>({
      hostname: "dev.azure.com",
      path: `${ctx.repositoriesPath}/${encodedRepo}/pullrequests?api-version=7.1`,
      method: "POST",
      headers: ctx.headers,
    }, JSON.stringify({
      sourceRefName: auxRefName,
      targetRefName: `refs/heads/${branch}`,
      title: commitMessage,
      description: `Archivo: ${filePath}\nRama destino: ${branch}`,
    }));

    return {
      mode: "pr",
      branch,
      auxBranch,
      commitId: push.commits?.[0]?.commitId ?? "desconocido",
      prId: pr.pullRequestId,
      prUrl: `${ctx.webProjectBase}/_git/${encodedRepo}/pullrequest/${pr.pullRequestId}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const duplicate = message.includes("409") || message.toLowerCase().includes("active pull request");
    if (!duplicate) throw error;

    return {
      mode: "pr",
      branch,
      auxBranch,
      commitId: push.commits?.[0]?.commitId ?? "desconocido",
      warning: `Ya existe un PR activo de '${auxBranch}' a '${branch}'. El commit fue subido igualmente.`,
    };
  }
}

export async function createBranch(connection: AzureConnection, repoName: string, sourceBranch: string, newBranch: string): Promise<{ branch: string; sourceBranch: string; objectId: string }> {
  await waitForRepositoryReadiness(connection, repoName);

  const refs = await getRepositoryRefs(connection, repoName);
  const existingRef = refs.value?.find((ref) => ref.name === `refs/heads/${newBranch}`);
  if (existingRef) {
    return { branch: newBranch, sourceBranch, objectId: existingRef.objectId };
  }

  const sourceRef = refs.value?.find((ref) => ref.name === `refs/heads/${sourceBranch}`);
  if (!sourceRef) {
    throw new Error(`No se encontro la rama base '${sourceBranch}' en el repositorio '${repoName}'.`);
  }

  const ctx = createAzureContext(connection);
  const encodedRepo = encodeSegment(repoName);
  const result = await httpsRequest<RefUpdateResult>({
    hostname: "dev.azure.com",
    path: `${ctx.repositoriesPath}/${encodedRepo}/refs?api-version=7.1`,
    method: "POST",
    headers: ctx.headers,
  }, JSON.stringify([{
    name: `refs/heads/${newBranch}`,
    newObjectId: sourceRef.objectId,
    oldObjectId: EMPTY_OBJECT_ID,
  }]));

  const created = result.value?.[0];
  if (!created?.success) {
    throw new Error(`No se pudo crear la rama '${newBranch}'.`);
  }

  return { branch: newBranch, sourceBranch, objectId: created.newObjectId };
}

export async function createPullRequest(connection: AzureConnection, repoName: string, sourceBranch: string, targetBranch: string, title: string, description?: string): Promise<{ pullRequestId: number; url: string }> {
  const ctx = createAzureContext(connection);
  const encodedRepo = encodeSegment(repoName);
  const pr = await httpsRequest<PullRequestResponse>({
    hostname: "dev.azure.com",
    path: `${ctx.repositoriesPath}/${encodedRepo}/pullrequests?api-version=7.1`,
    method: "POST",
    headers: ctx.headers,
  }, JSON.stringify({
    sourceRefName: sourceBranch.startsWith("refs/heads/") ? sourceBranch : `refs/heads/${sourceBranch}`,
    targetRefName: targetBranch.startsWith("refs/heads/") ? targetBranch : `refs/heads/${targetBranch}`,
    title,
    description: description?.trim() || "Automatizado por Agent Azure DevOps MCP",
  }));

  return {
    pullRequestId: pr.pullRequestId,
    url: `${ctx.webProjectBase}/_git/${encodedRepo}/pullrequest/${pr.pullRequestId}`,
  };
}
