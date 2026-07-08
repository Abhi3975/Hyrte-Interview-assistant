# Deployment Guide

## Environments

| Env | Cluster | DB | Notes |
|-----|---------|----|-------|
| local | docker-compose | Postgres container | full stack on your machine |
| staging | EKS `interviewai-staging` | RDS single-AZ | auto-deploy on merge to `main` |
| production | EKS `interviewai-prod` | RDS Multi-AZ + replica | manual approval gate |

## 1. Provision infrastructure (Terraform)

```bash
cd infra/terraform
terraform init -backend-config=env/prod.backend.hcl
terraform apply -var env=prod
```

Provisions VPC (3 AZs), EKS (managed + spot node groups), RDS Postgres
(Multi-AZ primary + read replica), ElastiCache Redis (cluster mode), and S3.
Outputs the cluster name, DB endpoints, and Redis endpoint.

## 2. Cluster add-ons

```bash
aws eks update-kubeconfig --name interviewai-prod
# AWS Load Balancer Controller (for the ALB Ingress)
# External Secrets Operator (syncs AWS Secrets Manager → K8s Secrets)
# metrics-server (required by HPA)
# kube-prometheus-stack (monitoring)
helm install monitoring prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace -f infra/monitoring/prometheus-values.yaml
```

## 3. Secrets

Populate AWS Secrets Manager (`interviewai/prod/*`) with `DATABASE_URL`,
`DATABASE_REPLICA_URL`, `REDIS_URL`, JWT secrets, `PROCTOR_WEBHOOK_SECRET`, and
AI provider keys. The External Secrets Operator materializes them into the
`interviewai-secrets` K8s Secret. **Never commit real secrets** —
`infra/k8s/config.yaml` ships placeholders only.

## 4. Database migrations

Run as a one-off Job / CI step before rolling pods (not in the container CMD):

```bash
npx prisma migrate deploy --schema=prisma/schema.prisma
```

## 5. Deploy

CI/CD (`.github/workflows/ci.yml`) runs: **lint → test → security scan (Trivy) →
build & push images (GHCR) → deploy staging → [approval] → deploy production**.
Production uses a rolling update; combine with a canary/rolling-release strategy
for zero-downtime.

```bash
kubectl apply -f infra/k8s/namespace.yaml
kubectl apply -f infra/k8s/config.yaml
kubectl apply -f infra/k8s/api.yaml -f infra/k8s/web.yaml -f infra/k8s/ingress.yaml
kubectl -n interviewai rollout status deploy/api
```

## 6. Observability

- **Metrics**: expose `/metrics` (add `@nestjs/prometheus`); Prometheus scrapes
  pods labeled `app: api`. Grafana dashboards + SLO alerts ship in
  `infra/monitoring/`.
- **Traces**: set `OTEL_EXPORTER_OTLP_ENDPOINT` — the OpenTelemetry SDK exports
  spans to your collector.
- **Logs**: `nestjs-pino` emits structured JSON → shipped to the ELK stack /
  CloudWatch.

## Scaling knobs

- API HPA: 3→60 pods @ 65% CPU. Web HPA: 3→30 @ 70%.
- RDS: scale reads via the replica (`DATABASE_REPLICA_URL`); add PgBouncer for
  connection pooling as pod count grows.
- Redis cluster: 3 shards + replicas in prod.
- Kafka: partition `proctoring.events` by session for parallel consumers.

## Rollback

```bash
kubectl -n interviewai rollout undo deploy/api
```

Images are immutable (tagged by commit SHA), so rollback is instant and exact.
