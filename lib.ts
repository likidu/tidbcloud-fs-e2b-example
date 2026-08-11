import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { CommandExitError, Sandbox } from 'e2b'
import OpenAI from 'openai'
import pc from 'picocolors'

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
  console.log(pc.dim(`  [${label}] ${cmd}`))
  try {
    const result = await sbx.commands.run(cmd, { timeoutMs })
    const err = result.stderr.trim()
    if (err) console.log(pc.dim(`  [${label}] stderr: ${err}`))
    return result.stdout
  } catch (err) {
    if (err instanceof CommandExitError) {
      const stdout = err.stdout.trim()
      const stderr = err.stderr.trim()
      if (stdout) console.log(pc.dim(`  [${label}] stdout: ${stdout}`))
      if (stderr) console.log(pc.dim(`  [${label}] stderr: ${stderr}`))
      throw new Error(`${label} failed with exit code ${err.exitCode}${stderr ? `: ${stderr}` : ''}`, { cause: err })
    }
    throw err
  }
}

// The ti FUSE mount is visible only to the user that mounted it (ti has no
// allow_other option yet), and E2B's files API runs as a different user. So:
// stage the content on /tmp via the files API, then move it into the mount as
// the mounting user.
export async function writeFileViaMount(sbx: Sandbox, path: string, content: string): Promise<void> {
  const tmp = `/tmp/ti-write-${Math.random().toString(36).slice(2)}`
  await sbx.files.write(tmp, content)
  await run(sbx, 'write', `cp ${tmp} ${path} && rm -f ${tmp}`)
}

export async function createSandbox(): Promise<Sandbox> {
  const sbx = await Sandbox.create(TEMPLATE_NAME, {
    timeoutMs: 300_000,
    envs: {
      TI_REGION_CODE: process.env.TI_REGION_CODE ?? '',
      TI_FS_TOKEN: process.env.TI_FS_TOKEN ?? '',
    },
  })
  console.log(pc.dim(`  sandbox ${sbx.sandboxId} created`))
  try {
    await run(sbx, 'fuse-device', 'if [ -c /dev/fuse ] && [ ! -w /dev/fuse ]; then sudo chmod 0666 /dev/fuse; fi')
    try {
      await run(
        sbx,
        'mount',
        `ti fs mount-file-system --mount-path ${MOUNT_PATH} --remote-path ${REMOTE_PATH} --driver fuse --ready-timeout 60s`
      )
    } catch (err) {
      throw new Error(
        `ti fs mount failed inside the sandbox — check E2B network egress to the FS data plane and the TI_REGION_CODE/TI_FS_TOKEN values in .env. Cause: ${err}`
      )
    }
    return sbx
  } catch (err) {
    try {
      await sbx.kill()
    } catch (killErr) {
      console.log(pc.dim(`  failed to kill sandbox ${sbx.sandboxId} after setup error: ${killErr}`))
    }
    throw err
  }
}

export async function unmountAndKill(sbx: Sandbox): Promise<void> {
  let failure: unknown
  try {
    await run(sbx, 'drain', `ti fs drain-file-system --mount-path ${MOUNT_PATH} --timeout 60s`)
  } catch (err) {
    failure = err
  }
  try {
    await run(sbx, 'unmount', `ti fs unmount-file-system --mount-path ${MOUNT_PATH} --ignore-absent`)
  } catch (err) {
    failure ??= err
  }
  try {
    await sbx.kill()
    console.log(pc.dim(`  sandbox ${sbx.sandboxId} killed`))
  } catch (err) {
    failure ??= err
  }
  if (failure) throw failure
}

export function hostTi(...args: string[]): string {
  console.log(pc.dim(`$ ${['ti', 'fs', ...args].join(' ')}`))
  const out = execFileSync('ti', ['fs', ...args], { encoding: 'utf8' })
  console.log(pc.dim(out.trim()))
  return out
}

export function ensureRemoteDir(): void {
  try {
    execFileSync('ti', ['fs', 'create-directory', '--path', REMOTE_PATH, '--mode', '0755'], { stdio: 'pipe' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new Error("'ti' CLI not found on PATH — install it first: https://github.com/tidbcloud/ti-cli")
    }
    // Directory already exists — create-directory is the only expected failure here;
    // a real connectivity/credential problem will resurface loudly on the next command.
  }
}
