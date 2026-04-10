import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { initializeTools } from "./tools.js";

const INSTRUCTIONS = `
# agent-azuredevops

Servidor MCP para automatizar operaciones de Azure DevOps (repositorios, pipelines, Helm values) con arquitectura hexagonal.
Organizacion por defecto: grupodistelsa. Se puede sobreescribir con el campo "organization".

## Reglas de uso

- El PAT debe incluirse en cada llamada a una tool. No se almacena en el servidor.
- Solo las tools "use_case_*" estan disponibles. Cada una representa un flujo completo de negocio.
- Las operaciones de infraestructura (validar PAT, crear repos, registrar pipelines) son internas y se ejecutan automaticamente dentro de cada use-case.
- Los nombres de repositorios deben estar en kebab-case (ej: "mi-servicio", no "MiServicio").
- Las ramas estandar son: develop, QA, staging, main.

## Permisos de PAT requeridos

- Code (Read & Write): para leer/crear ramas, pushes y PRs en repos.
- Build (Read & Execute): para registrar pipelines.
- Project and Team (Read): para validar la organizacion.

## Use Cases disponibles

### use_case_repo_selfservice
Genera archivos values.yaml de Helm para Kubernetes y los publica en el repositorio "self-service-devops"
(o el repo destino indicado) en las cuatro ramas estandar (develop, QA, staging, main).
- Crea el repo destino si no existe.
- Hace push directo en repos nuevos; usa rama auxiliar + PR en repos existentes.
- Prerequisito: el repositorio de la aplicacion (repo_name) ya debe existir en Azure DevOps.

### use_case_repo_pipeline_trigger
Registra los cuatro pipelines estandar en Azure DevOps una vez que sus archivos YAML ya existen
en el repositorio (pipelines/dev-cicd-<repo>.yaml, etc.).
- Falla con lista de archivos faltantes si alguno no existe.
- Idempotente: si el pipeline ya esta registrado, lo reporta como "already_exists".
- Prerequisito: los cuatro archivos YAML deben existir en sus ramas correspondientes.

### use_case_repo_pipeline_plus
Genera el YAML CI/CD desde plantillas, lo sube a una rama de trabajo y abre un PR hacia la rama destino.
- Idempotente: si el archivo ya existe en la rama destino, no hace push ni crea PR.
- El YAML generado referencia plantillas del repositorio "self-service-devops/cicd-blueprints".

## Combinaciones ambiente/tecnologia con plantilla real

| tecnologia   | onpremise | cloud (AWS EKS) |
|--------------|-----------|-----------------|
| nodejs       | SI        | SI              |
| vite         | SI        | SI              |
| netcore      | SI        | SI              |
| react        | SI        | SI              |
| angular      | NO        | NO              |
| netframework | NO        | NO              |
| python       | NO        | NO              |
| flutter      | NO        | NO              |

Para combinaciones sin plantilla, usa use_case_repo_pipeline_trigger una vez que tengas el YAML manualmente.
`.trim();

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "agent-azuredevops", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );
  initializeTools(server);
  return server;
}
