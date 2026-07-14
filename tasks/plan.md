# tidbcloud-fs-for-e2b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable public sample showing two ephemeral E2B sandboxes sharing state through a mounted TiDB Cloud FS, with a mountless `tdc fs` finale from the host.

**Architecture:** Mirrors `drive9-for-e2b`: a code-defined E2B template (Ubuntu 22.04 + FUSE3 + `tdc`), a `lib.ts` that bootstraps `~/.tdc` profile files inside each sandbox and mounts the FS, a 3-act `demo.ts`, and a no-LLM `test.ts` smoke test. LLM calls go through the OpenAI SDK against Z.ai's OpenAI-compatible endpoint (GLM-5.2 default, fully env-overridable).

**Tech Stack:** TypeScript (ESM, tsx runner), `e2b` v2 SDK (Template builder + Sandbox), `openai` SDK, `dotenv`. No test framework — one pure-function unit file on `node:assert` plus the live smoke test.

## Global Constraints

- Node 20+; ESM (`"type": "module"`); scripts run via `tsx`.
- All demo artifacts live under remote path `/demo`; mount point inside sandboxes is `/home/user/workspace`.
- LLM defaults: base URL `https://api.z.ai/api/paas/v4`, model `glm-5.2`; both overridable via `LLM_BASE_URL` / `LLM_MODEL`.
- `tdc` fs commands read `fs_*` values only from profile files (`~/.tdc/config`, `~/.tdc/credentials`, TOML, `[default]` section) — never from env. Sandbox bootstrap must write these files.
- Every sandbox created in demo/test paths must be killed in a `finally` block.
- Live verification (template build, smoke test, demo) requires a populated `.env`; when credentials are unavailable, run `npm run typecheck` + `npm run test:unit` and flag the live steps as pending — never claim live verification you didn't run.
- Commit after every task.

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`

**Interfaces:**
- Produces: npm scripts `build`, `test`, `test:unit`, `demo`, `typecheck` used by all later tasks; the `.env` contract every later task reads.

- [x] **Step 1: Write `package.json`**

```json
{
  "name": "tidbcloud-fs-for-e2b",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "description": "E2B sandbox template and examples for TiDB Cloud FS shared workspaces, with an OpenAI-compatible LLM (GLM-5.2 default).",
  "scripts": {
    "build": "tsx build.ts",
    "test:unit": "tsx lib.unit.ts",
    "test": "tsx test.ts",
    "demo": "tsx demo.ts",
    "typecheck": "tsc --noEmit"
  }
}
```

- [x] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["*.ts"]
}
```

- [x] **Step 3: Write `.gitignore`**

```
node_modules/
.env
```

- [x] **Step 4: Write `.env.example`**

```
# E2B
E2B_API_KEY=
E2B_TEMPLATE_NAME=tidbcloud-fs-workspace-dev

# LLM (any OpenAI-compatible endpoint; defaults target Z.ai GLM-5.2)
LLM_API_KEY=
LLM_BASE_URL=https://api.z.ai/api/paas/v4
LLM_MODEL=glm-5.2

# TiDB Cloud API credentials
TDC_REGION_CODE=aws-us-east-1
TDC_PUBLIC_KEY=
TDC_PRIVATE_KEY=

# TiDB Cloud FS resource. Run `tdc fs create-file-system --file-system-name <name>`
# once on this machine, then copy the fs_* values it stored in
# ~/.tdc/config and ~/.tdc/credentials into the variables below.
TDC_FS_RESOURCE_NAME=
TDC_FS_TENANT_ID=
TDC_FS_CLOUD_PROVIDER=aws
TDC_FS_REGION_CODE=aws-us-east-1
TDC_FS_API_KEY=

# Optional: override where template.ts downloads the tdc installer from
# (defaults to the latest GitHub release).
# TDC_INSTALL_URL=
```

- [x] **Step 5: Install dependencies (latest resolutions, recorded into package.json)**

Run: `npm install dotenv e2b openai && npm install -D typescript tsx @types/node`
Expected: `package.json` gains `dependencies`/`devDependencies` blocks; `package-lock.json` created; exit 0.

- [x] **Step 6: Verify typecheck runs clean on the empty project**

Run: `npm run typecheck`
Expected: exit 0 (no input files is acceptable at this stage — if tsc errors with "No inputs were found", create an empty `lib.ts` placeholder is NOT the fix; instead pass because Task 2 adds the first .ts file. If tsc exits non-zero solely for "no inputs", note it and proceed.)

- [x] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .env.example
git commit -m "chore: scaffold tidbcloud-fs-for-e2b project"
```

---

### Task 2: E2B template (`template.ts` + `build.ts`)

**Files:**
- Create: `template.ts`, `build.ts`

**Interfaces:**
- Produces: exported `template` (E2B Template definition); template alias from `E2B_TEMPLATE_NAME` env (default `tidbcloud-fs-workspace-dev`) that `lib.ts` passes to `Sandbox.create`.

- [x] **Step 1: Write `template.ts`**

```ts
import { Template } from 'e2b'

const TDC_INSTALL_URL =
  process.env.TDC_INSTALL_URL ||
  'https://github.com/tidbcloud/tdc/releases/latest/download/install.sh'

export const template = Template()
  .fromImage('ubuntu:22.04')
  .aptInstall(['ca-certificates', 'curl', 'fuse3', 'procps', 'sudo'])
  .runCmd('id -u user >/dev/null 2>&1 || useradd -m -s /bin/bash user', { user: 'root' })
  .runCmd(
    'usermod -aG sudo user && printf "user ALL=(ALL) NOPASSWD:ALL\\n" >/etc/sudoers.d/99-e2b-user && chmod 0440 /etc/sudoers.d/99-e2b-user',
    { user: 'root' }
  )
  .runCmd('printf "user_allow_other\\n" >/etc/fuse.conf && chmod 0644 /etc/fuse.conf', { user: 'root' })
  .runCmd(
    `curl -fsSL '${TDC_INSTALL_URL}' -o /tmp/tdc-install.sh && bash /tmp/tdc-install.sh --version latest --install-dir /usr/local/bin --yes && rm -f /tmp/tdc-install.sh`,
    { user: 'root' }
  )
  .runCmd('tdc --version', { user: 'root' })
  .runCmd('fusermount3 --version', { user: 'root' })
  .runCmd('mkdir -p /home/user/workspace && chown -R user:user /home/user/workspace', { user: 'root' })
  .setUser('user')
  .setWorkdir('/home/user')
```

- [x] **Step 2: Write `build.ts`**

```ts
import 'dotenv/config'
import { Template, defaultBuildLogger } from 'e2b'
import { template } from './template'

const alias = process.env.E2B_TEMPLATE_NAME || 'tidbcloud-fs-workspace-dev'

const result = await Template.build(template, {
  alias,
  cpuCount: 2,
  memoryMB: 4096,
  onBuildLogs: defaultBuildLogger(),
})

console.log(`built template '${alias}': ${result.templateId}`)
```

Note: if the installed `e2b` version's `Template.build` signature differs (e.g. option named `name` instead of `alias`), fix against `node_modules/e2b/dist/index.d.ts` — do not guess.

- [x] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Build the template live (requires `E2B_API_KEY`; requires the tdc release to be public)**

Run: `npm run build`
Expected: build log ends with `built template 'tidbcloud-fs-workspace-dev': <id>`.
If the tdc GitHub release is not yet published, set `TDC_INSTALL_URL` in `.env` to a reachable copy of `install.sh` (or an internal URL serving a Linux amd64 build) and rerun. If no E2B key is available, mark this step pending in the commit message.

- [x] **Step 5: Commit**

```bash
git add template.ts build.ts
git commit -m "feat: add E2B template with FUSE3 and tdc CLI"
```

---

### Task 3: Sandbox + LLM library (`lib.ts`) with TDD on profile rendering

**Files:**
- Create: `lib.unit.ts` (test first), `lib.ts`

**Interfaces:**
- Consumes: template alias from Task 2.
- Produces (used by `demo.ts`/`test.ts`):
  - `MOUNT_PATH: string` (`/home/user/workspace`), `REMOTE_PATH: string` (`/demo`), `LLM_MODEL: string`
  - `requireEnvs(names: string[]): void` — throws listing every missing env var
  - `renderTdcProfile(env: Record<string, string | undefined>): { config: string; credentials: string }`
  - `llmClient(): OpenAI`
  - `createSandbox(): Promise<Sandbox>` — create, write profile files, mount, return
  - `run(sbx: Sandbox, label: string, cmd: string, timeoutMs?: number): Promise<string>` — returns stdout, throws on non-zero exit
  - `unmountAndKill(sbx: Sandbox): Promise<void>`
  - `hostTdc(...args: string[]): string` — echoes and runs `tdc fs <args...>` on the host via `execFileSync` (no shell), returns stdout
  - `ensureRemoteDir(): void` — idempotently creates `REMOTE_PATH` host-side

- [x] **Step 1: Write the failing unit test (`lib.unit.ts`)**

```ts
import assert from 'node:assert/strict'
import { renderTdcProfile, requireEnvs } from './lib'

const env = {
  TDC_REGION_CODE: 'aws-us-east-1',
  TDC_PUBLIC_KEY: 'pub"lic',
  TDC_PRIVATE_KEY: 'priv\\ate',
  TDC_FS_RESOURCE_NAME: 'workspace',
  TDC_FS_TENANT_ID: 't-123',
  TDC_FS_CLOUD_PROVIDER: 'aws',
  TDC_FS_REGION_CODE: 'aws-us-east-1',
  TDC_FS_API_KEY: 'fsk_abc',
}

const { config, credentials } = renderTdcProfile(env)

assert.equal(
  config,
  `[default]
region_code = "aws-us-east-1"
fs_resource_name = "workspace"
fs_tenant_id = "t-123"
fs_cloud_provider = "aws"
fs_region_code = "aws-us-east-1"
`
)
// JSON string escaping is valid TOML basic-string escaping — quotes and
// backslashes in secrets must survive round-tripping.
assert.equal(
  credentials,
  `[default]
tdc_public_key = "pub\\"lic"
tdc_private_key = "priv\\\\ate"
fs_api_key = "fsk_abc"
`
)

assert.throws(() => requireEnvs(['NOPE_A', 'NOPE_B']), /NOPE_A.*NOPE_B|NOPE_A, NOPE_B/)
requireEnvs(['PATH']) // present everywhere; must not throw

console.log('lib.unit.ts: all assertions passed')
```

- [x] **Step 2: Run it to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot resolve `./lib`.

- [x] **Step 3: Write `lib.ts`**

```ts
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { Sandbox } from 'e2b'
import OpenAI from 'openai'

export const TEMPLATE_NAME = process.env.E2B_TEMPLATE_NAME || 'tidbcloud-fs-workspace-dev'
export const MOUNT_PATH = '/home/user/workspace'
export const REMOTE_PATH = '/demo'
export const LLM_MODEL = process.env.LLM_MODEL || 'glm-5.2'

export function requireEnvs(names: string[]): void {
  const missing = names.filter((n) => !process.env[n]?.trim())
  if (missing.length > 0) {
    throw new Error(`missing required environment variables: ${missing.join(', ')} (see .env.example)`)
  }
}

// JSON string escaping is valid TOML basic-string escaping.
const toml = (value: string) => JSON.stringify(value)

export function renderTdcProfile(env: Record<string, string | undefined>): {
  config: string
  credentials: string
} {
  const config = [
    '[default]',
    `region_code = ${toml(env.TDC_REGION_CODE ?? '')}`,
    `fs_resource_name = ${toml(env.TDC_FS_RESOURCE_NAME ?? '')}`,
    `fs_tenant_id = ${toml(env.TDC_FS_TENANT_ID ?? '')}`,
    `fs_cloud_provider = ${toml(env.TDC_FS_CLOUD_PROVIDER ?? '')}`,
    `fs_region_code = ${toml(env.TDC_FS_REGION_CODE ?? '')}`,
    '',
  ].join('\n')
  const credentials = [
    '[default]',
    `tdc_public_key = ${toml(env.TDC_PUBLIC_KEY ?? '')}`,
    `tdc_private_key = ${toml(env.TDC_PRIVATE_KEY ?? '')}`,
    `fs_api_key = ${toml(env.TDC_FS_API_KEY ?? '')}`,
    '',
  ].join('\n')
  return { config, credentials }
}

export function llmClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.LLM_API_KEY,
    baseURL: process.env.LLM_BASE_URL || 'https://api.z.ai/api/paas/v4',
  })
}

export async function run(sbx: Sandbox, label: string, cmd: string, timeoutMs = 180_000): Promise<string> {
  console.log(`  [${label}] ${cmd}`)
  const result = await sbx.commands.run(cmd, { timeoutMs })
  const err = result.stderr.trim()
  if (err) console.log(`  [${label}] stderr: ${err}`)
  return result.stdout
}

export async function createSandbox(): Promise<Sandbox> {
  const sbx = await Sandbox.create(TEMPLATE_NAME, { timeoutMs: 300_000 })
  console.log(`  sandbox ${sbx.sandboxId} created`)
  try {
    const { config, credentials } = renderTdcProfile(process.env)
    await sbx.files.write('/home/user/.tdc/config', config)
    await sbx.files.write('/home/user/.tdc/credentials', credentials)
    await run(sbx, 'secure-profile', 'chmod 700 /home/user/.tdc && chmod 600 /home/user/.tdc/credentials')
    await run(sbx, 'fuse-device', 'if [ -c /dev/fuse ] && [ ! -w /dev/fuse ]; then sudo chmod 0666 /dev/fuse; fi')
    await run(
      sbx,
      'mount',
      `tdc fs mount-file-system --mount-path ${MOUNT_PATH} --remote-path ${REMOTE_PATH} --ready-timeout 60s`
    )
    return sbx
  } catch (err) {
    // Spec: any error path kills created sandboxes — never leak a billed sandbox.
    try {
      await sbx.kill()
    } catch (killErr) {
      console.log(`  failed to kill sandbox ${sbx.sandboxId} after setup error: ${killErr}`)
    }
    throw err
  }
}

export async function unmountAndKill(sbx: Sandbox): Promise<void> {
  try {
    await run(sbx, 'unmount', `tdc fs unmount-file-system --mount-path ${MOUNT_PATH} --ignore-absent`)
  } finally {
    await sbx.kill()
    console.log(`  sandbox ${sbx.sandboxId} killed`)
  }
}

export function hostTdc(...args: string[]): string {
  console.log(`$ ${['tdc', 'fs', ...args].join(' ')}`)
  const out = execFileSync('tdc', ['fs', ...args], { encoding: 'utf8' })
  console.log(out.trim())
  return out
}

export function ensureRemoteDir(): void {
  try {
    execFileSync('tdc', ['fs', 'create-directory', '--path', REMOTE_PATH, '--mode', '0755'], { stdio: 'pipe' })
  } catch {
    // Directory already exists — create-directory is the only expected failure here;
    // a real connectivity/credential problem will resurface loudly on the next command.
  }
}
```

- [x] **Step 4: Run unit test to verify it passes**

Run: `npm run test:unit`
Expected: `lib.unit.ts: all assertions passed`, exit 0.

- [x] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. If `sbx.files.write` / `sbx.commands.run` option names differ in the installed e2b version, fix against `node_modules/e2b/dist/index.d.ts`.

- [x] **Step 6: Commit**

```bash
git add lib.ts lib.unit.ts
git commit -m "feat: sandbox lifecycle, tdc profile bootstrap, and LLM client library"
```

---

### Task 4: Smoke test (`test.ts`)

**Files:**
- Create: `test.ts`

**Interfaces:**
- Consumes: everything in `lib.ts` except `llmClient` (no LLM dependency by design — this is the pre-demo rehearsal).

- [x] **Step 1: Write `test.ts`**

```ts
import {
  MOUNT_PATH,
  REMOTE_PATH,
  createSandbox,
  ensureRemoteDir,
  hostTdc,
  requireEnvs,
  run,
  unmountAndKill,
} from './lib'

requireEnvs([
  'E2B_API_KEY',
  'TDC_REGION_CODE',
  'TDC_PUBLIC_KEY',
  'TDC_PRIVATE_KEY',
  'TDC_FS_RESOURCE_NAME',
  'TDC_FS_TENANT_ID',
  'TDC_FS_CLOUD_PROVIDER',
  'TDC_FS_REGION_CODE',
  'TDC_FS_API_KEY',
])

const stamp = `tdc fs smoke ${Date.now()}`

console.log('smoke: sandbox mount, write, read-back')
ensureRemoteDir()
const sbx = await createSandbox()
try {
  await sbx.files.write(`${MOUNT_PATH}/smoke.txt`, stamp)
  const back = (await run(sbx, 'read-back', `cat ${MOUNT_PATH}/smoke.txt`)).trim()
  if (back !== stamp) {
    throw new Error(`read-back mismatch: wrote ${JSON.stringify(stamp)}, got ${JSON.stringify(back)}`)
  }
} finally {
  await unmountAndKill(sbx)
}

console.log('smoke: mountless read from host after sandbox death')
const remote = hostTdc('cat', '--path', `${REMOTE_PATH}/smoke.txt`).trim()
if (remote !== stamp) {
  throw new Error(`mountless read mismatch: wrote ${JSON.stringify(stamp)}, got ${JSON.stringify(remote)}`)
}
hostTdc('rm', '--path', `${REMOTE_PATH}/smoke.txt`)

console.log('SMOKE TEST PASSED')
```

- [x] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Run the smoke test live (requires populated `.env` + built template + host `tdc` on PATH)**

Run: `npm test`
Expected: ends with `SMOKE TEST PASSED`, exit 0. This step also settles design open item 2 (E2B sandbox → fs data-plane network reachability). If it fails on mount readiness, capture the mount error output verbatim before touching anything — it distinguishes network egress from credential problems.

- [x] **Step 4: Commit**

```bash
git add test.ts
git commit -m "feat: mount/write/read smoke test with mountless host verification"
```

---

### Task 5: The 3-act demo (`demo.ts`)

**Files:**
- Create: `demo.ts`

**Interfaces:**
- Consumes: everything in `lib.ts`.

- [x] **Step 1: Write `demo.ts`**

```ts
import {
  LLM_MODEL,
  MOUNT_PATH,
  REMOTE_PATH,
  createSandbox,
  ensureRemoteDir,
  hostTdc,
  llmClient,
  requireEnvs,
  run,
  unmountAndKill,
} from './lib'

requireEnvs([
  'E2B_API_KEY',
  'LLM_API_KEY',
  'TDC_REGION_CODE',
  'TDC_PUBLIC_KEY',
  'TDC_PRIVATE_KEY',
  'TDC_FS_RESOURCE_NAME',
  'TDC_FS_TENANT_ID',
  'TDC_FS_CLOUD_PROVIDER',
  'TDC_FS_REGION_CODE',
  'TDC_FS_API_KEY',
])

const llm = llmClient()

async function ask(prompt: string, maxTokens: number): Promise<string> {
  const r = await llm.chat.completions.create({
    model: LLM_MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = (r.choices[0]?.message?.content ?? '').trim()
  if (!text) throw new Error(`empty completion from ${LLM_MODEL}`)
  return text
}

ensureRemoteDir()

console.log('=== Act 1: Agent 1 writes a question to the shared filesystem ===')
const sbx1 = await createSandbox()
let question: string
try {
  question = await ask('Ask one interesting philosophical question. Just the question, nothing else.', 256)
  await sbx1.files.write(`${MOUNT_PATH}/question.txt`, question)
  console.log(`Agent 1 wrote: "${question}"`)
} finally {
  await unmountAndKill(sbx1)
}

console.log('\n=== Act 2: a brand-new sandbox mounts the same filesystem and answers ===')
const sbx2 = await createSandbox()
try {
  const question2 = (await run(sbx2, 'read-question', `cat ${MOUNT_PATH}/question.txt`)).trim()
  console.log(`Agent 2 read: "${question2}"`)
  const answer = await ask(`Answer this question thoughtfully in 2-3 sentences: ${question2}`, 512)
  await sbx2.files.write(`${MOUNT_PATH}/answer.txt`, answer)
  console.log(`Agent 2 wrote: "${answer}"`)
} finally {
  await unmountAndKill(sbx2)
}

console.log('\n=== Act 3: both sandboxes are dead — read everything with no mount at all ===')
hostTdc('ls', '--path', REMOTE_PATH)
hostTdc('cat', '--path', `${REMOTE_PATH}/answer.txt`)
const keyword = (question.match(/[A-Za-z]{5,}/g) ?? ['question'])[0]
hostTdc('grep', '--pattern', keyword, '--path', REMOTE_PATH)

console.log('\nThe filesystem outlived both sandboxes, and act 3 never mounted anything.')
```

- [x] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Run the demo live**

Run: `npm run demo`
Expected: three act banners; act 3 prints each `$ tdc fs ...` command followed by its output; final line about the filesystem outliving the sandboxes; exit 0.

- [x] **Step 4: Commit**

```bash
git add demo.ts
git commit -m "feat: 3-act demo with mountless finale"
```

---

### Task 6: README and wrap-up

**Files:**
- Create: `README.md`
- Modify: `tasks/plan.md` (results section), `docs/superpowers/specs/2026-07-14-tidbcloud-fs-for-e2b-design.md` (results section)

- [x] **Step 1: Write `README.md`**

````markdown
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
````

- [x] **Step 2: Verify quickstart accuracy against reality**

Run: `npm install && npm run typecheck && npm run test:unit`
Expected: all exit 0 — confirming the README's quickstart commands exist and the repo is clonable-and-runnable up to the credential-gated steps.

- [x] **Step 3: Add results/review sections to `tasks/plan.md` and the design spec**

Record: what was verified live vs pending (template build, smoke, demo), any deviations from plan, and the resolution of the three design open items (install URL, E2B network reachability, Z.ai endpoint).

- [x] **Step 4: Commit**

```bash
git add README.md tasks/plan.md docs/superpowers/specs/2026-07-14-tidbcloud-fs-for-e2b-design.md
git commit -m "docs: README, plan results, and spec wrap-up"
```

---

## Results / Review

### What was built

All six tasks executed via subagent-driven development on branch `impl/e2b-example` (2026-07-14). Final tree: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `template.ts`, `build.ts`, `lib.ts`, `lib.unit.ts`, `test.ts`, `demo.ts`, `README.md`. Deps resolved: e2b@2.33.0, openai@6.46.0, dotenv@17.4.2, typescript@7.0.2, tsx@4.23.1.

### Verified in this environment

- `npm run typecheck` — exit 0 (all files, TypeScript 7).
- `npm run test:unit` — all assertions pass (TOML rendering incl. quote/backslash escaping round-trip, requireEnvs).
- Per-task spec+quality reviews: all six tasks approved; Task 3 required one fix round (below).
- e2b@2.33.0 API surface verified against installed typings (Template.build deprecated overload, commands.run throw-on-nonzero, files.write parent-dir creation).
- `install.sh` flags (`--version`, `--install-dir`, `--yes`) verified against the tdc repo's actual script.

### Pending (no credentials in this environment — run once `.env` is populated)

- Task 2 Step 4: `npm run build` (E2B template build) — also settles design open item 1 (release URL) once the technical-preview release is live.
- Task 4 Step 3: `npm test` (live smoke) — settles design open item 2 (E2B→fs data-plane network reachability).
- Task 5 Step 3: `npm run demo` — settles design open item 3 (Z.ai endpoint/model id) on first real LLM call.

### Deviations from plan

1. **Review-driven fixes to lib.ts (commit a048e44):** `createSandbox` now kills the sandbox on any post-create failure (spec's "any error path kills created sandboxes" was under-implemented in the plan's original snippet); `hostTdc`/`ensureRemoteDir` switched from shell `execSync` to argv-based `execFileSync` (`hostTdc(...args: string[])`) to remove a shell-injection surface. Plan snippets and Task 4/5 call sites were synced (commit e992b85).
2. Live verification steps deferred as pending rather than executed — no `.env`, no host `tdc` binary in this environment.

### Minor findings deferred to/through final review

- `hostTdc` echo line joins argv with spaces (cosmetic ambiguity if an arg contains a space).
- `toml()` leaves U+007F unescaped (theoretical; keys are hex/base64-shaped).
- `test.ts` mountless stage: `rm` cleanup not in try/finally (self-healing — next run overwrites smoke.txt).
- `ask()` empty-completion error doesn't say which act it fired in.
- `template.ts` overwrites `/etc/fuse.conf` rather than appending (stock file is comments only).

### Final whole-branch review (2026-07-14)

Verdict: ready to merge **with fixes** — all actionable findings applied in commit `a5501926` (LICENSE, `ensureRemoteDir` ENOENT surfacing, mount-failure hint per spec, non-deprecated `Template.build(template, name, options)` signature with `TEMPLATE_NAME` imported from lib.ts, act-labeled LLM errors with 1024-token caps, spec env-table correction). All five earlier deferred minors triaged fine-as-is.

**Pre-publication user decisions (not merge blockers):** remove `docs/shared-example.ts` (the archived Archil reference sample) from the public tree; strip or rewrite the internal docs (`docs/superpowers/specs/`, `tasks/plan.md`) which name drive9 provenance and the parity-demo intent; publish via a fresh history rather than this branch's history, since deleted files remain in past commits.

### Live verification round (2026-07-14, later)

- Host `tdc` built from source (darwin/arm64, `~/.local/bin/tdc`) after installing Go; host profile bootstrapped from `.env` (one-off script; `~/.tdc` had no config).
- `pnpm build` ✅ — template builds with the local tarball (`TDC_TARBALL_PATH`); resolves open item 1 for the pre-release path.
- `pnpm test` ✅ **SMOKE TEST PASSED live** — mount inside E2B works (open item 2 resolved: sandbox egress reaches the fs data plane), FUSE write/read round-trip, mountless host read + cleanup after sandbox death.
- `pnpm demo` — acts run, but the LLM call fails with Z.ai `429 Insufficient balance`; blocked on account recharge, not code (open item 3 still pending on first successful call). Sandbox cleanup on the failure path worked as designed.
- **New deviation:** `writeFileViaMount` staging helper added — tdc FUSE mounts lack `allow_other`, so E2B's files API (different user than the mounting user) gets EACCES writing into the mount directly. Filed as tdc product feedback: add `--allow-other` to `tdc fs mount-file-system` (requires `user_allow_other` in fuse.conf, which the template already sets).
