# TiDB Cloud FS for E2B — Example Design

**Date:** 2026-07-14
**Status:** Approved (pending final user review)

## Purpose

A public sample repo (`tidbcloud-fs-for-e2b`) that doubles as an internal parity demo. It shows that TiDB Cloud FS (the drive9-based first-party filesystem in TiDB Cloud, accessed via the `tdc` CLI) covers the same E2B use case as Archil and drive9's own `drive9-for-e2b` sample — persistent shared storage across ephemeral sandboxes — and adds one differentiator those solutions structurally lack: **mountless access**, where the filesystem is also an API.

Optimize for: a crisp 2-minute live-demo story, and a clean runnable quickstart for outside developers. Not optimized for: exhaustive CLI surface coverage or long-term feature accretion.

## Demo narrative (3 acts)

1. **Agent 1.** A fresh E2B sandbox mounts the shared TiDB Cloud FS with `tdc fs mount-file-system`. GLM-5.2 generates a philosophical question; the script writes it to `<mount>/question.txt` through the ordinary mounted filesystem. The sandbox unmounts and is killed.
2. **Agent 2.** A brand-new sandbox (no state carried over) mounts the same FS, reads `question.txt`, asks GLM-5.2 for an answer, writes `answer.txt`, unmounts, and is killed.
3. **Mountless finale.** Both sandboxes are dead. From the host — no sandbox, no FUSE, no mount — the demo runs and prints:
   - `tdc fs ls --path /demo`
   - `tdc fs cat --path /demo/answer.txt`
   - `tdc fs grep --pattern <word-from-question> --path /demo`

   The artifacts outlive the compute, and reading them never required a mount. This is the beat Archil/drive9 cannot do.

All demo artifacts live under a `/demo` prefix on the remote FS so cleanup is one recursive delete.

## Repo layout

Mirrors `drive9-for-e2b` so the comparison is self-evident:

| File | Contents |
| --- | --- |
| `template.ts` | E2B template definition: Ubuntu 22.04 + FUSE3 + `tdc` installed via the GitHub Releases `install.sh` one-liner (`github.com/tidbcloud/tdc`). |
| `lib.ts` | `createSandbox()` — create sandbox from template, write `~/.tdc/config` and `~/.tdc/credentials` inside the sandbox from env values, run `tdc fs mount-file-system --mount-path ... --remote-path /demo --ready-timeout ...`; `unmountAndKill(sbx)` — drain/unmount, then kill. LLM client factory (OpenAI SDK with configurable base URL/model). |
| `demo.ts` | The 3-act flow. Act 3 executes the `tdc fs` commands host-side via `child_process` and echoes each command before its output, so a presenter can also type them by hand. |
| `test.ts` | Smoke test: create sandbox, mount, write a file, read it back, unmount, kill, then verify host-side with `tdc fs cat`. No LLM calls. This is the pre-demo rehearsal command. |
| `README.md` | What it shows, prerequisites, quickstart, the manual act-3 commands, "also possible" pointers (layers, fs-journal, fs-vault). |
| `.env.example` | See env table below. |
| `package.json`, `tsconfig.json` | Node 20+, TypeScript. |

## Stack and key decisions

- **Language:** TypeScript, `e2b` SDK — same as both reference repos.
- **LLM:** GLM-5.2 as the OSS-friendly default, called through the **`openai` npm package** against Z.ai's OpenAI-compatible endpoint. No first-party Zhipu TS SDK exists; the OpenAI wire protocol is their stable pay-as-you-go path. Base URL and model are env-configurable so any OpenAI-compatible server works (OpenRouter, Together, self-hosted vLLM/SGLang).
- **File I/O goes through the real mount.** Unlike the Archil sample's base64-through-shell helpers, agents write with plain `tee`/`cat` against the mounted path. No custom read/write wrappers in `lib.ts` beyond thin command runners.
- **Credentials into the sandbox:** `tdc` fs data-plane/mount commands read `fs_*` metadata and `fs_api_key` from profile files only (no env override exists). `createSandbox()` therefore renders `~/.tdc/config` and `~/.tdc/credentials` inside the sandbox from the host-provided env values. The README documents how to obtain them (`tdc fs create-file-system` once on the host, then copy the generated `fs_*` values from `~/.tdc/credentials`).

### Environment variables (`.env.example`)

| Variable | Purpose |
| --- | --- |
| `E2B_API_KEY` | E2B sandbox access |
| `E2B_TEMPLATE_NAME` | Template alias built by `template.ts` (default `tidbcloud-fs-workspace-dev`) |
| `LLM_API_KEY` | Z.ai (or compatible) API key |
| `LLM_BASE_URL` | Default `https://api.z.ai/api/paas/v4` |
| `LLM_MODEL` | Default `glm-5.2` |
| `TDC_PUBLIC_KEY` / `TDC_PRIVATE_KEY` | TiDB Cloud API credentials (control plane) |
| `TDC_REGION_CODE` | e.g. `aws-us-east-1` |
| `TDC_FS_RESOURCE_NAME`, `TDC_FS_TENANT_ID`, `TDC_FS_CLOUD_PROVIDER`, `TDC_FS_REGION_CODE`, `TDC_FS_API_KEY` | Values rendered into the sandbox profile files (names mirror the `fs_*` profile keys) |

## Error handling / demo safety

- Mount uses `--ready-timeout` with a clear failure message naming the likely cause (network egress, credentials).
- Any error path kills created sandboxes (`try/finally`) so a failed live run leaks nothing.
- `test.ts` is the rehearsal: run it before any live demo.
- Act 3 commands echo before executing so partial failures are legible on stage.

## Out of scope (documented as "also possible" in the README)

- Layers (copy-on-write branches, diff/commit/rollback)
- fs-journal as an agent coordination log
- fs-vault delegated tokens for scoped sandbox credentials
- Repo-analysis demo (drive9's `demo.ts` workload) — candidate for a later `demo-advanced.ts`

## Open items to resolve at implementation

1. Exact `install.sh` URL/tag once this week's technical-preview release of `tdc` is published; until then, build against a locally-built Linux binary copied into the template.
2. Verify the fs region data-plane endpoint is reachable from E2B's sandbox network (first thing `test.ts` proves).
3. Confirm Z.ai endpoint/model id (`glm-5.2`) against docs.z.ai at implementation time.

## Results / review

Implemented 2026-07-14 on branch `impl/e2b-example` per `tasks/plan.md` (see its Results section for detail). All static verification passed (typecheck, unit tests, per-task reviews). The three open items remain pending on live credentials: template build against the published release, E2B→fs network reachability (first `npm test`), and Z.ai endpoint confirmation (first `npm run demo`). One design-level correction discovered in review: host-side `tdc` invocations are argv-based (`execFileSync`), not shell-interpolated, and `createSandbox` kills the sandbox on any setup failure — both now reflected in the plan.
