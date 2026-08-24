#!/usr/bin/env bash
#
# HYRTE — build, push, migrate, and deploy onto the newly-provisioned account.
# Run ./infra/provision-new-account.sh first, then fill in the secrets it
# lists, then run this.
#
# Idempotent: safe to re-run. Creates the ECS services on the first run and
# rolls them to a new image on subsequent runs.

set -euo pipefail

cd "$(dirname "$0")/.."
[ -f infra/.new-account-env ] || { echo "Run ./infra/provision-new-account.sh first."; exit 1; }
# shellcheck disable=SC1091
source infra/.new-account-env

aws() { command aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"; }
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()  { printf '    \033[0;32m✓\033[0m %s\n' "$*"; }

REGISTRY="${ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Refuse to deploy with placeholder secrets still in place — a running-but-
# broken deployment is worse than a stopped one, and this exact class of
# failure (a stale/invalid API key silently degrading every session to a
# fallback fixture) already bit this project once in the old account.
log "Checking secrets are filled in"
if grep -q PLACEHOLDER_SET_ME infra/taskdef-api.json; then
  echo "  infra/taskdef-api.json still contains PLACEHOLDER_SET_ME values."
  echo "  Fill them in before deploying (see provision script's output)."
  exit 1
fi
ok "no placeholders remain"

log "Logging in to ECR"
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
ok "$REGISTRY"

build_push() { # service, dockerfile
  local svc="$1" dockerfile="$2"
  log "Building $svc (linux/arm64)"
  docker build --provenance=false --sbom=false --platform linux/arm64 \
    -f "$dockerfile" -t "${REGISTRY}/${PREFIX}-${svc}:latest" .
  log "Pushing $svc"
  # The api image's node_modules layer is ~583MB and this push has been
  # observed to drop mid-transfer on flaky links; retry rather than fail the
  # whole deploy. Each retry reuses already-uploaded layers.
  local attempt=1
  until docker push "${REGISTRY}/${PREFIX}-${svc}:latest"; do
    attempt=$((attempt + 1))
    [ "$attempt" -gt 5 ] && { echo "push failed after 5 attempts"; exit 1; }
    echo "  push interrupted, retry ${attempt}/5..."
    aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
  done
  ok "$svc pushed"
}

build_push api apps/api/Dockerfile
build_push web apps/web/Dockerfile

pin_digest() { # service -> writes a digest-pinned copy of the taskdef
  local svc="$1"
  local digest
  digest=$(aws ecr describe-images --repository-name "${PREFIX}-${svc}" \
    --image-ids imageTag=latest --query 'imageDetails[0].imageDigest' --output text)
  node -e "
    const fs = require('fs');
    const td = JSON.parse(fs.readFileSync('infra/taskdef-${svc}.json', 'utf8'));
    td.containerDefinitions[0].image = '${REGISTRY}/${PREFIX}-${svc}@${digest}';
    fs.writeFileSync('infra/.taskdef-${svc}-pinned.json', JSON.stringify(td, null, 2));
  "
  echo "$digest"
}

log "Pinning image digests"
API_DIGEST=$(pin_digest api)
WEB_DIGEST=$(pin_digest web)
ok "api ${API_DIGEST:0:19}… / web ${WEB_DIGEST:0:19}…"

# ── Schema push ───────────────────────────────────────────────────────────
# Always run against the NEW api image (not the currently-running one) — a
# db-push based on a stale image reports "already in sync" against the OLD
# schema, which is a real trap this project hit before.
log "Pushing database schema (one-off ECS task on the new image)"
node -e "
  const fs = require('fs');
  const td = JSON.parse(fs.readFileSync('infra/.taskdef-api-pinned.json', 'utf8'));
  td.family = '${PREFIX}-api-dbpush';
  td.containerDefinitions[0].command = ['npx','prisma','db','push','--schema=prisma/schema.prisma','--skip-generate'];
  fs.writeFileSync('infra/.taskdef-dbpush.json', JSON.stringify(td, null, 2));
"
aws ecs register-task-definition --cli-input-json file://infra/.taskdef-dbpush.json >/dev/null
TASK_ARN=$(aws ecs run-task --cluster "$PREFIX" --task-definition "${PREFIX}-api-dbpush" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNET_CSV}],securityGroups=[${ECS_SG}],assignPublicIp=ENABLED}" \
  --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster "$PREFIX" --tasks "$TASK_ARN"
EXIT=$(aws ecs describe-tasks --cluster "$PREFIX" --tasks "$TASK_ARN" --query 'tasks[0].containers[0].exitCode' --output text)
TASK_ID="${TASK_ARN##*/}"
# Exit code alone is not trusted here — confirm from the real log output.
LOGS=$(aws logs get-log-events --log-group-name "/ecs/${PREFIX}-api" \
  --log-stream-name "api/api/${TASK_ID}" --query 'events[*].message' --output text 2>/dev/null || true)
if [ "$EXIT" != "0" ] || ! echo "$LOGS" | grep -q "in sync"; then
  echo "  Schema push did not confirm success. Exit=$EXIT"
  echo "$LOGS" | tail -20
  exit 1
fi
ok "database is in sync"

# ── Services ──────────────────────────────────────────────────────────────
deploy_service() { # service, port, targetgroup
  local svc="$1" port="$2" tg="$3"
  log "Deploying $svc service"
  local td_arn
  td_arn=$(aws ecs register-task-definition --cli-input-json "file://infra/.taskdef-${svc}-pinned.json" \
    --query 'taskDefinition.taskDefinitionArn' --output text)

  if aws ecs describe-services --cluster "$PREFIX" --services "$svc" \
       --query 'services[0].status' --output text 2>/dev/null | grep -q ACTIVE; then
    aws ecs update-service --cluster "$PREFIX" --service "$svc" --task-definition "$td_arn" >/dev/null
    ok "rolling $svc to $(basename "$td_arn")"
  else
    aws ecs create-service --cluster "$PREFIX" --service-name "$svc" \
      --task-definition "$td_arn" --desired-count 1 --launch-type FARGATE \
      --network-configuration "awsvpcConfiguration={subnets=[${SUBNET_CSV}],securityGroups=[${ECS_SG}],assignPublicIp=ENABLED}" \
      --load-balancers "targetGroupArn=${tg},containerName=${svc},containerPort=${port}" \
      --health-check-grace-period-seconds 120 >/dev/null
    ok "created $svc"
  fi
}

deploy_service api 4000 "$API_TG"
deploy_service web 3000 "$WEB_TG"

log "Waiting for both services to stabilize"
aws ecs wait services-stable --cluster "$PREFIX" --services api web
ok "both services stable"

# ── Verify ────────────────────────────────────────────────────────────────
# main.ts excludes 'health' from the global 'api' prefix, so the app's real
# health route is bare /health — not reachable through the public ALB at all
# (the listener only forwards /api/* to this service, and the container
# doesn't answer unprefixed /health from an /api/health request either).
# ECS's own target-group health check hits it directly, bypassing listener
# rules — that's the signal to trust, not a public curl. For a real signed
# response, POST to a live route and expect its actual validation error
# rather than a routing failure.
log "Verifying"
API_TG_ARN=$(aws elbv2 describe-target-groups --names "${PREFIX}-api-tg" --query 'TargetGroups[0].TargetGroupArn' --output text)
for i in $(seq 1 20); do
  TG_HEALTHY=$(aws elbv2 describe-target-health --target-group-arn "$API_TG_ARN" \
    --query "length(TargetHealthDescriptions[?TargetHealth.State=='healthy'])" --output text)
  AUTH_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://${ALB_DNS}/api/auth/login" \
    -H "Content-Type: application/json" -d '{}' || true)
  WEB_CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://${ALB_DNS}/" || true)
  echo "  attempt $i: api-targets-healthy=$TG_HEALTHY auth-login=$AUTH_CODE web=$WEB_CODE"
  [ "$TG_HEALTHY" != "0" ] && [ "$AUTH_CODE" = "400" ] && [ "$WEB_CODE" = "200" ] && break
  sleep 10
done

cat <<SUMMARY

  Deployed.
    Web : http://${ALB_DNS}/
    API : http://${ALB_DNS}/api/ (health check is internal-only, see note above)

  A CloudFront distribution in front of the ALB is optional — the old
  account used one purely for the HTTPS default domain. Create it with:
    ./infra/add-cloudfront.sh

SUMMARY
