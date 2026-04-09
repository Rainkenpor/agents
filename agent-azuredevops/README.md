# Agent Azure DevOps MCP

Migracion del software actual a un MCP orientado a codigo con arquitectura hexagonal.

## Estructura

- `application/use-cases`: solo los 3 casos de uso migrados desde flows
- `domain/ports`: contratos del dominio
- `domain/services`: servicios de dominio para generar contenido reutilizable
- `shared`: utilidades compartidas del dominio/aplicacion
- `infrastructure/adapters`: adaptadores concretos
- `infrastructure/azuredevops`: acceso a Azure DevOps usado por la implementacion activa
- `infrastructure/mcp`: registro de tools y ensamblaje MCP

## Casos de uso expuestos como tools

- `use_case_repo_selfservice`
- `use_case_repo_pipeline_trigger`
- `use_case_repo_pipeline_plus`

## Tools auxiliares

- `azdo_validate_pat`
- `azdo_check_repository`
- `azdo_create_repository`
- `azdo_register_pipeline`
- `render_helm_values`

## Regla aplicada

- un flow migrado = un use case

## Nota

Los archivos legacy que sigan visibles fuera de esta estructura pueden eliminarse cuando no esten bloqueados por el editor.
