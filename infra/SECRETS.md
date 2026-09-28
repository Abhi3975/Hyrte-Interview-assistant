# Secrets — rotation and hardening

Two separate jobs. **Rotation** needs your hands (only you can issue new keys
at each provider). **Hardening** is a script in this directory that stops the
keys being readable in plaintext, and can run before or after rotation.

## Where the secrets actually live

All seven sit in `infra/taskdef-api.json` under the container's `environment`
array, in plaintext, with zero Secrets Manager references.

`infra/taskdef-api.json` and `infra/.new-account-env` are **not tracked in
git** — verified with `git ls-files`. Nothing was ever committed to the repo.

What plaintext-in-a-task-definition does mean:

- anyone with `ecs:DescribeTaskDefinition` on account `917286218781` can read
  every key, including revoked ones, in **every past revision** (34 and
  counting) — revisions are immutable and cannot be scrubbed
- they appear in CloudTrail request/response logs for those calls
- they are visible in the ECS console to any reader

| Variable | Provider | Rotate where |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI | platform.openai.com → API keys |
| `ELEVENLABS_API_KEY` | ElevenLabs | elevenlabs.io → Profile → API key |
| `RESEND_API_KEY` | Resend | resend.com → API keys |
| `JWT_ACCESS_SECRET` | self-generated | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | self-generated | `openssl rand -hex 32` |
| `PROCTOR_WEBHOOK_SECRET` | self-generated | `openssl rand -hex 32` |
| `DATABASE_URL` | AWS RDS | RDS console → modify master password |

**`RESEND_API_KEY` is currently the placeholder `TEMP_AW…`, not a real key** —
so transactional email (OTP, report links) is not working in production today.
Worth fixing at the same time.

## Rotating the two JWT secrets logs everyone out

Changing `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` invalidates every issued
token, so all active sessions are signed out and have to log in again. Harmless,
but do it when nobody is mid-demo.

## Order of operations

1. Issue the new key at the provider, but **do not revoke the old one yet**.
2. Put the new value into `infra/taskdef-api.json` (or, after hardening, into
   Secrets Manager — see below).
3. `./infra/deploy-new-account.sh`
4. Confirm the rollout actually took — a green script is not proof, see
   `deploy-verification` notes:

   ```bash
   source infra/.new-account-env && aws --profile "$AWS_PROFILE" --region "$AWS_REGION" \
     ecs describe-services --cluster hyrte --services api web \
     --query 'services[].deployments[].{td:taskDefinition,running:runningCount,failed:failedTasks,rollout:rolloutState}'
   ```

   Want `failed: 0` and `rollout: COMPLETED`.
5. Exercise the path that uses the key (start an interview for OpenAI, TTS for
   ElevenLabs, an OTP email for Resend).
6. **Only then** revoke the old key at the provider.

Doing step 6 first means a broken production between revoke and deploy.

## Hardening: `./infra/harden-secrets.sh`

Moves all seven out of `environment` and into AWS Secrets Manager, so the task
definition carries ARNs instead of values. Run it with `--dry-run` first; it
prints every change and writes nothing.

It does three things, and the third is the one that can break a deploy:

1. creates/updates one Secrets Manager secret per variable under `hyrte/`
2. rewrites `taskdef-api.json`, moving each var from `environment` to `secrets`
   with a `valueFrom` ARN
3. attaches `secretsmanager:GetSecretValue` for those ARNs to the task
   **execution** role — without this the tasks cannot start at all

Because of (3), run it when you can watch a deploy, not immediately before a
demo. If a rollout does fail, ECS keeps serving the previous revision, so the
site stays up while you fix it — but new code will not ship until you do.

After hardening, a rotation is `aws secretsmanager put-secret-value` plus a
redeploy; the task definition never contains a key again.
