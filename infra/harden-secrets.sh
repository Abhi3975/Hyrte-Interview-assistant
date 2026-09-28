#!/usr/bin/env bash
#
# Move the API's secrets out of the task definition's plaintext `environment`
# array and into AWS Secrets Manager, so a task definition revision never again
# contains a readable key. See infra/SECRETS.md.
#
# Idempotent: re-running updates the secret values and leaves everything else
# alone. --dry-run prints every change and writes nothing.
#
# NOTE: this grants the task EXECUTION role secretsmanager:GetSecretValue for
# these ARNs. Without that grant the tasks cannot start, so run this when you
# can watch a deploy — not immediately before a demo.

set -euo pipefail
cd "$(dirname "$0")/.."
[ -f infra/.new-account-env ] || { echo "infra/.new-account-env missing."; exit 1; }
# shellcheck disable=SC1091
source infra/.new-account-env

DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

aws() { command aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"; }
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()  { printf '    \033[0;32m✓\033[0m %s\n' "$*"; }
skip(){ printf '    \033[0;33m—\033[0m %s\n' "$*"; }

TD=infra/taskdef-api.json
SECRET_VARS=(
  DATABASE_URL
  JWT_ACCESS_SECRET
  JWT_REFRESH_SECRET
  OPENAI_API_KEY
  ELEVENLABS_API_KEY
  RESEND_API_KEY
  PROCTOR_WEBHOOK_SECRET
)

# ── 1. Refuse to run against placeholders ────────────────────────────────────
log "Checking for placeholder values"
declare -a PLACEHOLDERS=()
for name in "${SECRET_VARS[@]}"; do
  value=$(node -e "
    const td=require('./$TD');
    const e=(td.containerDefinitions[0].environment||[]).find(x=>x.name===process.argv[1]);
    process.stdout.write(e ? String(e.value ?? '') : '');
  " "$name")
  if [ -z "$value" ]; then
    skip "$name not present in environment (already moved, or unset)"
  elif [[ "$value" == *PLACEHOLDER* || "$value" == TEMP_* ]]; then
    # Left in plaintext deliberately: a placeholder is not a secret, and
    # putting it in Secrets Manager would dress up a broken integration as a
    # protected one. Skipped rather than fatal, so one unconfigured provider
    # cannot block hardening the keys that ARE real.
    printf '    \033[0;33m!\033[0m %s is a placeholder (%s) — SKIPPING, and that integration is not working\n' "$name" "$value"
    PLACEHOLDERS+=("$name")
  else
    ok "$name looks real (${#value} chars)"
  fi
done

# Drop the placeholders from the list actually processed below.
if [ ${#PLACEHOLDERS[@]} -gt 0 ]; then
  REAL_VARS=()
  for name in "${SECRET_VARS[@]}"; do
    keep=true
    for ph in "${PLACEHOLDERS[@]}"; do [ "$name" = "$ph" ] && keep=false; done
    $keep && REAL_VARS+=("$name")
  done
  SECRET_VARS=("${REAL_VARS[@]}")
fi

# ── 2. Create/update one secret per variable ─────────────────────────────────
log "Writing secrets to Secrets Manager under ${PREFIX}/"
declare -a ARNS=()
for name in "${SECRET_VARS[@]}"; do
  value=$(node -e "
    const td=require('./$TD');
    const e=(td.containerDefinitions[0].environment||[]).find(x=>x.name===process.argv[1]);
    process.stdout.write(e ? String(e.value ?? '') : '');
  " "$name")
  [ -z "$value" ] && { ARNS+=("") ; continue; }

  secret_id="${PREFIX}/${name}"
  if $DRY_RUN; then
    ok "would write $secret_id"
    ARNS+=("arn:aws:secretsmanager:${AWS_REGION}:${ACCOUNT}:secret:${secret_id}")
    continue
  fi

  if aws secretsmanager describe-secret --secret-id "$secret_id" >/dev/null 2>&1; then
    aws secretsmanager put-secret-value --secret-id "$secret_id" --secret-string "$value" >/dev/null
    ok "updated $secret_id"
  else
    aws secretsmanager create-secret --name "$secret_id" \
      --description "HYRTE API — $name (managed by infra/harden-secrets.sh)" \
      --secret-string "$value" >/dev/null
    ok "created $secret_id"
  fi
  ARNS+=("$(aws secretsmanager describe-secret --secret-id "$secret_id" --query ARN --output text)")
done

# ── 3. Rewrite the task definition: environment -> secrets ───────────────────
log "Rewriting $TD"
NAMES_CSV=$(IFS=,; echo "${SECRET_VARS[*]}")
ARNS_CSV=$(IFS=,; echo "${ARNS[*]}")
OUT=$TD
$DRY_RUN && OUT=/tmp/taskdef-api.hardened.json

node -e "
  const fs = require('fs');
  const td = JSON.parse(fs.readFileSync('$TD','utf8'));
  const names = '$NAMES_CSV'.split(',');
  const arns  = '$ARNS_CSV'.split(',');
  const c = td.containerDefinitions[0];
  c.environment = c.environment || [];
  c.secrets = c.secrets || [];
  let moved = 0;
  names.forEach((name, i) => {
    const arn = arns[i];
    if (!arn) return;
    const before = c.environment.length;
    c.environment = c.environment.filter(e => e.name !== name);
    if (c.environment.length === before) return;      // was not there
    if (!c.secrets.some(s => s.name === name)) c.secrets.push({ name, valueFrom: arn });
    moved++;
  });
  fs.writeFileSync('$OUT', JSON.stringify(td, null, 2) + '\n');
  console.log('    moved ' + moved + ' variable(s); ' + c.environment.length +
              ' plain env var(s) remain, ' + c.secrets.length + ' secret ref(s)');
"
$DRY_RUN && ok "dry run — wrote $OUT instead of $TD"

# ── 4. Let the execution role read them ──────────────────────────────────────
log "Granting the task execution role access"
EXEC_ROLE=$(node -e "
  const td=require('./$TD');
  process.stdout.write(String(td.executionRoleArn||'').split('/').pop());
")
[ -n "$EXEC_ROLE" ] || { echo "    could not read executionRoleArn from $TD"; exit 1; }

POLICY=$(node -e "
  const arns='$ARNS_CSV'.split(',').filter(Boolean).map(a => a + '*');
  process.stdout.write(JSON.stringify({
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Action: ['secretsmanager:GetSecretValue'], Resource: arns }],
  }));
")

if $DRY_RUN; then
  ok "would attach inline policy ${PREFIX}-secrets-read to $EXEC_ROLE"
  echo "$POLICY" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s),null,2)))"
else
  aws iam put-role-policy --role-name "$EXEC_ROLE" \
    --policy-name "${PREFIX}-secrets-read" --policy-document "$POLICY"
  ok "attached ${PREFIX}-secrets-read to $EXEC_ROLE"
fi

log "Done"
if [ ${#PLACEHOLDERS[@]} -gt 0 ]; then
  printf '    \033[0;33m!\033[0m left in plaintext because they are placeholders, not real keys: %s\n' "${PLACEHOLDERS[*]}"
fi
if $DRY_RUN; then
  cat <<'MSG'
    Nothing was changed. Re-run without --dry-run to apply, then:

      ./infra/deploy-new-account.sh

    and CONFIRM the rollout — a green script is not proof:

      aws ecs describe-services --cluster hyrte --services api web \
        --query 'services[].deployments[].{td:taskDefinition,failed:failedTasks,rollout:rolloutState}'

    Want failed: 0 and rollout: COMPLETED. If tasks fail to start, the cause is
    almost always step 4 — check /ecs/hyrte-api logs for a Secrets Manager
    AccessDenied.
MSG
else
  cat <<'MSG'
    Now deploy and confirm the rollout actually took:

      ./infra/deploy-new-account.sh

    Then check failed:0 / rollout:COMPLETED before trusting it. Past revisions
    of the task definition still contain the OLD plaintext values and cannot be
    scrubbed — so rotate the keys at each provider too (infra/SECRETS.md).
MSG
fi
