# Payload Examples

## `render_helm_values`

```json
{
  "app_repo_name": "mi-api",
  "image_project": "plataforma",
  "replica_count": 1,
  "has_service": true,
  "service_port": 8080,
  "has_ingress": true,
  "hosting": "AWS",
  "web_host": "mi-api.distelsa.net",
  "alb_name": "distelsa-internal",
  "branch": "develop"
}
```

## `use_case_repo_selfservice`

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
