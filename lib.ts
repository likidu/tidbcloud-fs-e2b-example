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
