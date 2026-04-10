# Payload Examples

## `use_case_create_selfservice_repository`

```json
{
  "organization": "grupodistelsa",
  "project": "plataforma",
  "repo_name": "mi-api",
  "image_project": "plataforma",
  "pat": "YOUR_PAT",
  "replica_count": 1,
  "has_service": true,
  "service_port": 8080,
  "has_ingress": true,
  "hosting": "AWS",
  "web_host": "mi-api.distelsa.net",
  "alb_name": "distelsa-internal",
  "target_repo": "self-service-devops"
}
```

## `use_case_repo_pipeline_trigger`

```json
{
  "organization": "grupodistelsa",
  "project": "plataforma",
  "repo_name": "mi-api",
  "pat": "YOUR_PAT"
}
```

## `use_case_repo_pipeline_plus`

```json
{
  "organization": "grupodistelsa",
  "project": "plataforma",
  "repo_name": "mi-api",
  "pat": "YOUR_PAT",
  "branch": "develop",
  "ambiente": "cloud",
  "tecnologia": "nodejs",
  "sonar_key": "mi-api",
  "sonar_name": "Mi API"
}
```

Notas:
- valida primero con `azdo_validate_pat` si no conoces el alcance del PAT
- esta tool crea rama de trabajo, push y PR si la rama destino aun no tiene el YAML
- hoy solo hay plantillas reales para `nodejs`, `vite`, `netcore` y `react`
