# TiDB Cloud FS for E2B

Persistent, shared storage for ephemeral [E2B](https://e2b.dev) sandboxes, backed by
[TiDB Cloud FS](https://www.pingcap.com/tidb-cloud/) via the `ti` CLI.

Two agents in two different sandboxes — the second created only after the first is
destroyed — exchange work through the same mounted filesystem. Then, with every
sandbox dead, the results are read back **with no mount at all**: TiDB Cloud FS is
also an API.

## The demo, in three acts

1. **Agent 1** — a fresh sandbox mounts the shared FS (`ti fs mount-file-system`),
   GLM-5.2 writes `question.txt` through the mount, the sandbox drains pending
   writes, unmounts and dies.
2. **Agent 2** — a brand-new sandbox mounts the same FS, reads the question, writes
   `answer.txt`, dies.
3. **Mountless finale** — from your machine, no FUSE, no sandbox:

   ```bash
   ti fs ls --path /demo
   ti fs cat --path /demo/answer.txt
   ti fs grep --pattern "<any word>" --path /demo
   ```

## Prerequisites

- Node.js 20+
- An [E2B](https://e2b.dev) API key
- The [`ti` CLI](https://github.com/tidbcloud/ti-cli) installed locally, used once
  to provision a TiDB Cloud FS resource:

  ```bash
  curl -fsSL https://github.com/tidbcloud/ti-cli/releases/latest/download/install.sh | sh -s -- --yes
  export PATH="$HOME/.ti/bin:$PATH"   # add to your shell profile to persist

  ti configure --non-interactive --region-code aws-ap-southeast-1 \
    --tidb-cloud-public-key <key> --tidb-cloud-private-key <key>   # from TiDB Cloud console → Organization Settings → API Keys
  ti fs create-file-system --wait \
    --query fs_token --output text
  ```

  The last command prints an `fs_token` — a credential scoped to that one
  filesystem. Put it in `.env` as `TI_FS_TOKEN`, alongside `TI_REGION_CODE`.
  The filesystem ID is derived from the token, so no filesystem name or ID is
  required. The TiDB Cloud public/private key pair is only needed for this
  one-time provisioning step; nothing else in this repo, including the
  sandboxes, ever sees it.

- An LLM API key for any OpenAI-compatible endpoint. The default configuration
  targets [Z.ai's GLM-5.2](https://docs.z.ai/guides/overview/quick-start) — an
  open-weight (MIT) model — but OpenRouter, Together, or a self-hosted
  vLLM/SGLang server all work: set `LLM_BASE_URL` and `LLM_MODEL`.
  GLM Coding Plan subscribers should set
  `LLM_BASE_URL=https://api.z.ai/api/coding/paas/v4` — plan quota is served
  through the coding endpoint, not the pay-as-you-go one.

## Quickstart

```bash
pnpm install
cp .env.example .env   # fill in TI_REGION_CODE / TI_FS_TOKEN
pnpm build             # build the E2B template (once)
pnpm test              # smoke test: mount, write, read back, mountless verify
pnpm demo              # the 3-act demo
```

## CI

Two GitHub Actions workflows test every PR:

| Workflow | Runs | What it does |
|---|---|---|
| `checks` | every PR + push to `main` | `pnpm typecheck`, `pnpm test:unit` — free, no secrets |
| `e2e` | push to `main`, manual dispatch, or PRs labeled `run-e2e` | full smoke test: rebuilds the E2B template as `tidbcloud-fs-ci`, then `pnpm test` (sandbox mount, write, read-back, mountless verify) |

The E2E workflow needs these repo secrets (Settings → Secrets and variables →
Actions): `E2B_API_KEY`, `TI_REGION_CODE`, `TI_FS_FILE_SYSTEM_NAME`,
`TI_FS_TOKEN`. The workflow maps them into both the `TDC_*` (main) and `TI_*`
(ti-CLI PRs) environment conventions, so the code under test finds its
variables whichever way it names them. Because it spends real E2B sandbox time
and touches the shared filesystem, it never runs automatically on fork PRs — a
maintainer opts a PR in by adding the `run-e2e` label, which approves running
that PR's code with the repo secrets (fork PRs don't receive secrets on
ordinary `pull_request` events).

## How the sandbox gets credentials

`ti` has a token-only mode built for exactly this kind of ephemeral machine: no
`ti configure`, no TiDB Cloud API keys, no `~/.ti/` profile files — just
`TI_FS_TOKEN` and `TI_REGION_CODE` as environment variables. `lib.ts`'s
`createSandbox()` passes those two straight from your `.env` into
`Sandbox.create()`'s `envs` option, so every `ti` command run inside the sandbox
picks them up automatically before mounting.

## Also possible with `ti fs` (not shown here)

- **Layers** — copy-on-write branches of the filesystem with diff/commit/rollback
  (`ti fs create-layer`, `diff-layer`, `commit-layer`)
- **Journals** — an append-only coordination log for agents (`ti fs-journal`)
- **Vault** — delegated, scoped access so sandboxes never hold your full key
  (`ti fs-vault create-grant`)
