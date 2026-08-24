# Migrating HYRTE to a new AWS account

Moves the whole stack from account `058264235219` / `ap-south-1` to a fresh
account. Three scripts, run in order. Everything is idempotent — a failed run
can simply be re-run.

## What gets created

| Resource | Detail |
|---|---|
| ECR | `hyrte-api`, `hyrte-web` |
| RDS | Postgres 16.14, `db.t3.micro`, 20 GB, **private** |
| S3 | `hyrte-recordings-<account>` — private, AES256, 90-day expiry |
| IAM | `hyrteEcsExec`, `hyrteApiTaskRole` (scoped to the one bucket) |
| ALB | `hyrte-alb` — `:80`, `/api/*` → api, everything else → web |
| ECS | Fargate cluster `hyrte`, services `api` + `web`, ARM64, 512 CPU / 1024 MB |
| CloudFront | optional, gives you an HTTPS URL without owning a domain |

Two deliberate differences from the old account, both improvements:

- **The database is not publicly accessible.** The old one was
  (`PubliclyAccessible: true`), which was never necessary — the API reaches it
  through the VPC. Schema migrations run as one-off ECS tasks inside the VPC.
- **Secrets are never written by a script.** The task definitions ship with
  `PLACEHOLDER_SET_ME` and the deploy script refuses to run until a human has
  replaced them.

## Step 0 — credentials (you, once)

In the **new** account's console:

1. IAM → Users → **Create user**, name it `hyrte-deploy`
2. Attach **AdministratorAccess** (can be narrowed after the initial buildout)
3. Open the user → **Security credentials** → **Create access key** → **CLI**

Then, in a terminal:

```bash
aws configure --profile hyrte-new
# region: eu-north-1     output: json
```

Verify:

```bash
aws sts get-caller-identity --profile hyrte-new
```

## Step 1 — provision

```bash
AWS_PROFILE=hyrte-new AWS_REGION=eu-north-1 ./infra/provision-new-account.sh
```

Takes ~10 minutes, most of it waiting on RDS. Writes
`infra/taskdef-api.json`, `infra/taskdef-web.json`, and `infra/.new-account-env`.
The generated database password is saved to `infra/.db-password-<account>`
(gitignored, `chmod 600`).

## Step 2 — secrets

Edit `infra/taskdef-api.json` and replace every `PLACEHOLDER_SET_ME`:

| Variable | Where it comes from |
|---|---|
| `JWT_ACCESS_SECRET` | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | `openssl rand -hex 32` (a *different* one) |
| `OPENAI_API_KEY` | platform.openai.com |
| `ELEVENLABS_API_KEY` | elevenlabs.io — powers interview voice |
| `RESEND_API_KEY` | resend.com — transactional email |
| `RESEND_FROM` | the verified sender address on that Resend account |
| `PROCTOR_WEBHOOK_SECRET` | `openssl rand -hex 32` |

Generate fresh values rather than copying the old account's — the old ones
have been sitting in plaintext in a task definition and should be treated as
compromised. (See the standing note about rotating these.)

## Step 3 — deploy

```bash
./infra/deploy-new-account.sh
```

Builds both ARM64 images, pushes to ECR (with retries — the api image's
~583 MB `node_modules` layer drops on flaky links), runs the Prisma schema
push as a one-off task **on the new image** and confirms success from the real
CloudWatch log output, then creates or rolls both services and waits for them
to stabilize.

## Step 4 — HTTPS (recommended)

```bash
./infra/add-cloudfront.sh
```

Camera, microphone, and screen-share all require a secure context, so
proctored interviews and session recording will **not** work over the plain
HTTP ALB URL. After it deploys, set `WEB_BASE_URL` / `API_BASE_URL` to the
HTTPS domain and re-run step 3.

## Data

This is a **fresh, empty database** by design — no candidates, sessions, or
evaluations carry over. If the old account's data does need to move, that's a
separate `pg_dump` / `pg_restore` pass and worth planning deliberately; it
isn't part of these scripts.

## Old account

Left completely untouched and still serving traffic. Decommission only after
the new deployment has been verified end-to-end.
