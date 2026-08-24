#!/usr/bin/env bash
#
# HYRTE — full infrastructure provisioning on a fresh AWS account.
#
# Replicates the architecture currently running in account 058264235219
# (ap-south-1) into whatever account/region the given CLI profile points at.
# Idempotent: every step checks for an existing resource first, so a re-run
# after a partial failure resumes rather than duplicating.
#
# Usage:
#   ./infra/provision-new-account.sh
#
# Requires: AWS_PROFILE set to a profile with AdministratorAccess on the
# target account (see infra/README-migration.md).
#
# What this creates:
#   VPC (default) + security groups, ECR repos, RDS Postgres, S3 recordings
#   bucket, IAM roles, CloudWatch log groups, ALB + target groups + listener,
#   ECS cluster + services, CloudFront distribution.
#
# What this deliberately does NOT do:
#   - Copy data from the old account's database (fresh, empty DB by design).
#   - Set any secret values. Secrets are written as PLACEHOLDER and must be
#     filled in by a human (see the SECRETS section printed at the end).

set -euo pipefail

PROFILE="${AWS_PROFILE:-hyrte-new}"
REGION="${AWS_REGION:-eu-north-1}"
PREFIX="hyrte"
DB_NAME="hyrte"
DB_USER="hyrte"

aws() { command aws --profile "$PROFILE" --region "$REGION" "$@"; }
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()  { printf '    \033[0;32m✓\033[0m %s\n' "$*"; }

log "Verifying credentials"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ok "Account $ACCOUNT, region $REGION"

# ── Networking ────────────────────────────────────────────────────────────
log "VPC + subnets (using the account's default VPC)"
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
[ "$VPC" = "None" ] && { echo "No default VPC in $REGION — create one first."; exit 1; }
SUBNETS=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC" --query 'Subnets[].SubnetId' --output text)
SUBNET_CSV=$(echo "$SUBNETS" | tr '\t' ',')
ok "VPC $VPC with subnets: $SUBNET_CSV"

log "Security groups"
make_sg() { # name, description
  local id
  id=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=$1" "Name=vpc-id,Values=$VPC" \
        --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo None)
  if [ "$id" = "None" ]; then
    id=$(aws ec2 create-security-group --group-name "$1" --description "$2" --vpc-id "$VPC" --query GroupId --output text)
  fi
  echo "$id"
}
ALB_SG=$(make_sg "${PREFIX}-alb-sg" "HYRTE ALB")
ECS_SG=$(make_sg "${PREFIX}-ecs-sg" "HYRTE ECS tasks")
DB_SG=$(make_sg  "${PREFIX}-db-sg"  "HYRTE RDS")

# ALB: public HTTP. ECS: only from ALB. DB: only from ECS.
aws ec2 authorize-security-group-ingress --group-id "$ALB_SG" --protocol tcp --port 80 --cidr 0.0.0.0/0 2>/dev/null || true
aws ec2 authorize-security-group-ingress --group-id "$ECS_SG" --protocol tcp --port 4000 --source-group "$ALB_SG" 2>/dev/null || true
aws ec2 authorize-security-group-ingress --group-id "$ECS_SG" --protocol tcp --port 3000 --source-group "$ALB_SG" 2>/dev/null || true
aws ec2 authorize-security-group-ingress --group-id "$DB_SG"  --protocol tcp --port 5432 --source-group "$ECS_SG" 2>/dev/null || true
ok "alb=$ALB_SG ecs=$ECS_SG db=$DB_SG"

# ── ECR ───────────────────────────────────────────────────────────────────
log "ECR repositories"
for repo in "${PREFIX}-api" "${PREFIX}-web"; do
  aws ecr describe-repositories --repository-names "$repo" >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name "$repo" >/dev/null
  ok "$repo"
done

# ── RDS ───────────────────────────────────────────────────────────────────
log "RDS Postgres (db.t3.micro, 20GB — matches the current deployment)"
DB_ID="${PREFIX}-db"
if ! aws rds describe-db-instances --db-instance-identifier "$DB_ID" >/dev/null 2>&1; then
  # Deliberately pipeline-free: `... | head -c 32` makes the upstream process
  # die of SIGPIPE, which under `set -o pipefail` kills the whole script.
  # 16 bytes of hex is 32 alphanumeric chars — well within RDS's password rules.
  DB_PASS=$(openssl rand -hex 16)
  echo "$DB_PASS" > "infra/.db-password-${ACCOUNT}"
  chmod 600 "infra/.db-password-${ACCOUNT}"
  aws rds create-db-instance \
    --db-instance-identifier "$DB_ID" \
    --db-instance-class db.t3.micro \
    --engine postgres --engine-version 16.14 \
    --allocated-storage 20 \
    --master-username "$DB_USER" --master-user-password "$DB_PASS" \
    --db-name "$DB_NAME" \
    --vpc-security-group-ids "$DB_SG" \
    --backup-retention-period 7 \
    --no-publicly-accessible >/dev/null
  ok "Creating $DB_ID (password saved to infra/.db-password-${ACCOUNT}, gitignored)"
  echo "    waiting for the instance to become available (typically 5-10 min)..."
  aws rds wait db-instance-available --db-instance-identifier "$DB_ID"
fi
DB_HOST=$(aws rds describe-db-instances --db-instance-identifier "$DB_ID" --query 'DBInstances[0].Endpoint.Address' --output text)
ok "DB endpoint: $DB_HOST"

# ── S3 ────────────────────────────────────────────────────────────────────
log "S3 recordings bucket (private, encrypted, 90-day expiry)"
BUCKET="${PREFIX}-recordings-${ACCOUNT}"
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET" \
    --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  aws s3api put-public-access-block --bucket "$BUCKET" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-encryption --bucket "$BUCKET" \
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" \
    --lifecycle-configuration '{"Rules":[{"ID":"expire-90d","Status":"Enabled","Filter":{"Prefix":""},"Expiration":{"Days":90}}]}'
fi
ok "$BUCKET"

# ── IAM ───────────────────────────────────────────────────────────────────
log "IAM roles"
EXEC_ROLE="${PREFIX}EcsExec"
TASK_ROLE="${PREFIX}ApiTaskRole"
TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

if ! aws iam get-role --role-name "$EXEC_ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$EXEC_ROLE" --assume-role-policy-document "$TRUST" >/dev/null
  aws iam attach-role-policy --role-name "$EXEC_ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
fi
ok "$EXEC_ROLE"

if ! aws iam get-role --role-name "$TASK_ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$TASK_ROLE" --assume-role-policy-document "$TRUST" >/dev/null
  aws iam put-role-policy --role-name "$TASK_ROLE" --policy-name s3-recordings \
    --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\",\"s3:GetObject\"],\"Resource\":\"arn:aws:s3:::${BUCKET}/*\"}]}"
fi
ok "$TASK_ROLE (scoped to $BUCKET only)"

# ── CloudWatch ────────────────────────────────────────────────────────────
log "CloudWatch log groups"
for lg in "/ecs/${PREFIX}-api" "/ecs/${PREFIX}-web"; do
  aws logs create-log-group --log-group-name "$lg" 2>/dev/null || true
  aws logs put-retention-policy --log-group-name "$lg" --retention-in-days 30
  ok "$lg"
done

# ── ALB ───────────────────────────────────────────────────────────────────
log "Application Load Balancer + target groups"
ALB_ARN=$(aws elbv2 describe-load-balancers --names "${PREFIX}-alb" --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || echo None)
if [ "$ALB_ARN" = "None" ]; then
  ALB_ARN=$(aws elbv2 create-load-balancer --name "${PREFIX}-alb" \
    --subnets $SUBNETS --security-groups "$ALB_SG" --scheme internet-facing --type application \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text)
  aws elbv2 wait load-balancer-available --load-balancer-arns "$ALB_ARN"
fi
ALB_DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" --query 'LoadBalancers[0].DNSName' --output text)
ok "$ALB_DNS"

make_tg() { # name, port, healthpath
  local arn
  arn=$(aws elbv2 describe-target-groups --names "$1" --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || echo None)
  if [ "$arn" = "None" ]; then
    arn=$(aws elbv2 create-target-group --name "$1" --protocol HTTP --port "$2" \
      --vpc-id "$VPC" --target-type ip --health-check-path "$3" \
      --query 'TargetGroups[0].TargetGroupArn' --output text)
  fi
  echo "$arn"
}
API_TG=$(make_tg "${PREFIX}-api-tg" 4000 /health)
WEB_TG=$(make_tg "${PREFIX}-web-tg" 3000 /)
ok "api-tg + web-tg"

LISTENER=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --query 'Listeners[0].ListenerArn' --output text 2>/dev/null || echo None)
if [ "$LISTENER" = "None" ] || [ -z "$LISTENER" ]; then
  LISTENER=$(aws elbv2 create-listener --load-balancer-arn "$ALB_ARN" --protocol HTTP --port 80 \
    --default-actions "Type=forward,TargetGroupArn=$WEB_TG" \
    --query 'Listeners[0].ListenerArn' --output text)
fi
# /api/* → api service, everything else → web (same routing as the current deployment)
aws elbv2 create-rule --listener-arn "$LISTENER" --priority 10 \
  --conditions 'Field=path-pattern,Values=/api/*' \
  --actions "Type=forward,TargetGroupArn=$API_TG" >/dev/null 2>&1 || true
ok "listener :80 with /api/* rule"

# ── ECS ───────────────────────────────────────────────────────────────────
# A brand-new account has never used ECS, so AWSServiceRoleForECS doesn't
# exist yet and the first create-cluster fails with "Unable to assume the
# service linked role". AWS does start creating it in the background at that
# point, but IAM is eventually-consistent — so create it explicitly and give
# it a moment to propagate rather than relying on that race.
log "ECS service-linked role"
if ! aws iam get-role --role-name AWSServiceRoleForECS >/dev/null 2>&1; then
  aws iam create-service-linked-role --aws-service-name ecs.amazonaws.com >/dev/null 2>&1 || true
  for _ in $(seq 1 12); do
    aws iam get-role --role-name AWSServiceRoleForECS >/dev/null 2>&1 && break
    sleep 5
  done
fi
ok "AWSServiceRoleForECS"

log "ECS cluster"
if ! aws ecs describe-clusters --clusters "$PREFIX" --query 'clusters[0].status' --output text 2>/dev/null | grep -q ACTIVE; then
  # Retry: the role can exist in IAM a few seconds before ECS can assume it.
  for attempt in $(seq 1 6); do
    aws ecs create-cluster --cluster-name "$PREFIX" --capacity-providers FARGATE >/dev/null 2>&1 && break
    [ "$attempt" = 6 ] && { echo "create-cluster failed after 6 attempts"; exit 1; }
    sleep 10
  done
fi
ok "$PREFIX"

log "Writing task definitions"
DB_PASS_FILE="infra/.db-password-${ACCOUNT}"
DB_PASS=$(cat "$DB_PASS_FILE" 2>/dev/null || echo "SET_ME")
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:5432/${DB_NAME}"

cat > infra/taskdef-api.json <<JSON
{
  "family": "${PREFIX}-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "runtimePlatform": { "cpuArchitecture": "ARM64", "operatingSystemFamily": "LINUX" },
  "executionRoleArn": "arn:aws:iam::${ACCOUNT}:role/${EXEC_ROLE}",
  "taskRoleArn": "arn:aws:iam::${ACCOUNT}:role/${TASK_ROLE}",
  "containerDefinitions": [{
    "name": "api",
    "image": "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${PREFIX}-api:latest",
    "essential": true,
    "portMappings": [{ "containerPort": 4000, "hostPort": 4000, "protocol": "tcp" }],
    "environment": [
      { "name": "NODE_ENV", "value": "production" },
      { "name": "API_PORT", "value": "4000" },
      { "name": "DATABASE_URL", "value": "${DATABASE_URL}" },
      { "name": "RECORDINGS_S3_BUCKET", "value": "${BUCKET}" },
      { "name": "AI_DEFAULT_PROVIDER", "value": "openai" },
      { "name": "AI_DEFAULT_MODEL", "value": "gpt-4o" },
      { "name": "WEB_BASE_URL", "value": "http://${ALB_DNS}" },
      { "name": "JWT_ACCESS_SECRET", "value": "PLACEHOLDER_SET_ME" },
      { "name": "JWT_REFRESH_SECRET", "value": "PLACEHOLDER_SET_ME" },
      { "name": "OPENAI_API_KEY", "value": "PLACEHOLDER_SET_ME" },
      { "name": "ELEVENLABS_API_KEY", "value": "PLACEHOLDER_SET_ME" },
      { "name": "RESEND_API_KEY", "value": "PLACEHOLDER_SET_ME" },
      { "name": "RESEND_FROM", "value": "PLACEHOLDER_SET_ME" },
      { "name": "PROCTOR_WEBHOOK_SECRET", "value": "PLACEHOLDER_SET_ME" }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/${PREFIX}-api",
        "awslogs-region": "${REGION}",
        "awslogs-stream-prefix": "api"
      }
    }
  }]
}
JSON

cat > infra/taskdef-web.json <<JSON
{
  "family": "${PREFIX}-web",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "runtimePlatform": { "cpuArchitecture": "ARM64", "operatingSystemFamily": "LINUX" },
  "executionRoleArn": "arn:aws:iam::${ACCOUNT}:role/${EXEC_ROLE}",
  "containerDefinitions": [{
    "name": "web",
    "image": "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${PREFIX}-web:latest",
    "essential": true,
    "portMappings": [{ "containerPort": 3000, "hostPort": 3000, "protocol": "tcp" }],
    "environment": [
      { "name": "NODE_ENV", "value": "production" },
      { "name": "API_BASE_URL", "value": "http://${ALB_DNS}/api" }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/${PREFIX}-web",
        "awslogs-region": "${REGION}",
        "awslogs-stream-prefix": "web"
      }
    }
  }]
}
JSON
ok "infra/taskdef-api.json, infra/taskdef-web.json"

# ── Summary ───────────────────────────────────────────────────────────────
cat > infra/.new-account-env <<ENV
# Generated by provision-new-account.sh — source this for the deploy script.
export AWS_PROFILE=${PROFILE}
export AWS_REGION=${REGION}
export ACCOUNT=${ACCOUNT}
export PREFIX=${PREFIX}
export VPC=${VPC}
export SUBNET_CSV=${SUBNET_CSV}
export ECS_SG=${ECS_SG}
export API_TG=${API_TG}
export WEB_TG=${WEB_TG}
export ALB_DNS=${ALB_DNS}
export DB_HOST=${DB_HOST}
export BUCKET=${BUCKET}
ENV

log "Infrastructure ready"
cat <<SUMMARY

  Account      : ${ACCOUNT}
  Region       : ${REGION}
  ALB          : http://${ALB_DNS}
  Database     : ${DB_HOST}
  Recordings   : ${BUCKET}

  NEXT — secrets must be set by a human before deploying:
    Edit infra/taskdef-api.json and replace every PLACEHOLDER_SET_ME:
      JWT_ACCESS_SECRET, JWT_REFRESH_SECRET  (any random 64-char hex)
      OPENAI_API_KEY, ELEVENLABS_API_KEY, RESEND_API_KEY, RESEND_FROM,
      PROCTOR_WEBHOOK_SECRET

    Generate the JWT secrets with:
      openssl rand -hex 32

  THEN run:  ./infra/deploy-new-account.sh

SUMMARY
