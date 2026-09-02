# TiDB Cloud FS for E2B

Persistent, shared storage for ephemeral [E2B](https://e2b.dev) sandboxes, backed by
[TiDB Cloud FS](https://www.pingcap.com/tidb-cloud/) via the `tdc` CLI.

Two agents in two different sandboxes — the second created only after the first is
destroyed — exchange work through the same mounted filesystem. Then, with every
sandbox dead, the results are read back **with no mount at all**: TiDB Cloud FS is
also an API.

## The demo, in three acts

1. **Agent 1** — a fresh sandbox mounts the shared FS (`tdc fs mount-file-system`),
   GLM-5.2 writes `question.txt` through the mount, the sandbox unmounts and dies.
2. **Agent 2** — a brand-new sandbox mounts the same FS, reads the question, writes
   `answer.txt`, dies.
3. **Mountless finale** — from your machine, no FUSE, no sandbox:

   ```bash
   tdc fs ls --path /demo
   tdc fs cat --path /demo/answer.txt
   tdc fs grep --pattern "<any word>" --path /demo
   ```

## Prerequisites

- Node.js 20+
- An [E2B](https://e2b.dev) API key
- The [`tdc` CLI](https://github.com/tidbcloud/tdc) installed locally, used once
  to provision a TiDB Cloud FS resource:

  ```bash
  curl -fsSL https://github.com/tidbcloud/tdc/releases/download/v0.1.7/install.sh | sh -s -- --version v0.1.7 --yes
  export PATH="$HOME/.tdc/bin:$PATH"   # add to your shell profile to persist

  tdc configure --non-interactive --region-code aws-us-east-1 \
    --tdc-public-key <key> --tdc-private-key <key>   # from TiDB Cloud console → Organization Settings → API Keys
  tdc fs create-file-system --file-system-name workspace \
    --query fs_token --output text
  ```

  (v0.1.7 is pinned because the `tdc` repo's "latest" release now installs the
  renamed [`ti`](https://github.com/tidbcloud/ti-cli) CLI instead.)

  The last command prints an `fs_token` — a credential scoped to that one
  filesystem. Put it in `.env` as `TDC_FS_TOKEN`, alongside `TDC_REGION_CODE`
  and `TDC_FS_FILE_SYSTEM_NAME`. The TiDB Cloud public/private key pair is
  only needed for this one-time provisioning step; nothing else in this repo,
  including the sandboxes, ever sees it.

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
cp .env.example .env   # fill in TDC_REGION_CODE / TDC_FS_FILE_SYSTEM_NAME / TDC_FS_TOKEN
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

`tdc` has a token-only mode built for exactly this kind of ephemeral machine: no
`tdc configure`, no TiDB Cloud API keys, no `~/.tdc/` profile files — just
`TDC_FS_TOKEN`, `TDC_REGION_CODE`, and `TDC_FS_FILE_SYSTEM_NAME` as environment
variables. `lib.ts`'s `createSandbox()` passes those three straight from your
`.env` into `Sandbox.create()`'s `envs` option, so every `tdc` command run
inside the sandbox picks them up automatically before mounting.

## Also possible with `tdc fs` (not shown here)

- **Layers** — copy-on-write branches of the filesystem with diff/commit/rollback
  (`tdc fs create-layer`, `diff-layer`, `commit-layer`)
- **Journals** — an append-only coordination log for agents (`tdc fs-journal`)
- **Vault** — delegated, scoped tokens so sandboxes never hold your full key
  (`tdc fs-vault create-token`)
