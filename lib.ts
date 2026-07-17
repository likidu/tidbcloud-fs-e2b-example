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

// The tdc FUSE mount is visible only to the user that mounted it (tdc has no
// allow_other option yet), and E2B's files API runs as a different user. So:
// stage the content on /tmp via the files API, then move it into the mount as
// the mounting user.
export async function writeFileViaMount(sbx: Sandbox, path: string, content: string): Promise<void> {
  const tmp = `/tmp/tdc-write-${Math.random().toString(36).slice(2)}`
  await sbx.files.write(tmp, content)
  await run(sbx, 'write', `cp ${tmp} ${path} && rm -f ${tmp}`)
}

export async function createSandbox(): Promise<Sandbox> {
  const sbx = await Sandbox.create(TEMPLATE_NAME, {
    timeoutMs: 300_000,
    envs: {
      TDC_REGION_CODE: process.env.TDC_REGION_CODE ?? '',
      TDC_FS_FILE_SYSTEM_NAME: process.env.TDC_FS_FILE_SYSTEM_NAME ?? '',
      TDC_FS_TOKEN: process.env.TDC_FS_TOKEN ?? '',
    },
  })
  console.log(`  sandbox ${sbx.sandboxId} created`)
  try {
    await run(sbx, 'fuse-device', 'if [ -c /dev/fuse ] && [ ! -w /dev/fuse ]; then sudo chmod 0666 /dev/fuse; fi')
    try {
      await run(
        sbx,
        'mount',
        `tdc fs mount-file-system --mount-path ${MOUNT_PATH} --remote-path ${REMOTE_PATH} --ready-timeout 60s`
      )
    } catch (err) {
      throw new Error(
        `tdc fs mount failed inside the sandbox — check E2B network egress to the fs data plane and the TDC_FS_* values in .env. Cause: ${err}`
      )
    }
    return sbx
  } catch (err) {
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
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new Error("'tdc' CLI not found on PATH — install it first: https://github.com/tidbcloud/tdc")
    }
    // Directory already exists — create-directory is the only expected failure here;
    // a real connectivity/credential problem will resurface loudly on the next command.
  }
}
