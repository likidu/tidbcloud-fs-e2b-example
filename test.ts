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
