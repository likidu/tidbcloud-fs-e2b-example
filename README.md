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
- The [`tdc` CLI](https://github.com/tidbcloud/tdc) installed locally, with a
  TiDB Cloud FS resource provisioned:

  ```bash
  tdc fs create-file-system --file-system-name workspace
  ```

- An LLM API key for any OpenAI-compatible endpoint. The default configuration
  targets [Z.ai's GLM-5.2](https://docs.z.ai/guides/overview/quick-start) — an
  open-weight (MIT) model — but OpenRouter, Together, or a self-hosted
  vLLM/SGLang server all work: set `LLM_BASE_URL` and `LLM_MODEL`.

## Quickstart

```bash
npm install
cp .env.example .env   # fill it in; fs_* values come from ~/.tdc/config and ~/.tdc/credentials
npm run build          # build the E2B template (once)
npm test               # smoke test: mount, write, read back, mountless verify
npm run demo           # the 3-act demo
```

## How the sandbox gets credentials

`tdc` fs commands read the filesystem identity and API key from profile files, not
environment variables. `lib.ts` renders `~/.tdc/config` and `~/.tdc/credentials`
inside each sandbox from your `.env` values before mounting. See `renderTdcProfile`.

## Also possible with `tdc fs` (not shown here)

- **Layers** — copy-on-write branches of the filesystem with diff/commit/rollback
  (`tdc fs create-layer`, `diff-layer`, `commit-layer`)
- **Journals** — an append-only coordination log for agents (`tdc fs-journal`)
- **Vault** — delegated, scoped tokens so sandboxes never hold your full key
  (`tdc fs-vault create-token`)
